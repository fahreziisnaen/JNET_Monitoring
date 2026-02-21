const pool = require('../config/database');
const RouterOSAPI = require('node-routeros').RouterOSAPI;
const crypto = require('crypto');
const {
    getConnection,
    addConnection,
    removeConnection,
    setIdleTimeout,
    addPendingRequest,
    isConnectionLocked,
    setConnectionLock,
    getConnectionLock,
    clearConnectionLock
} = require('../services/connectionManager');

// Deduplication map untuk command pembacaan yang sedang berjalan
const pendingReadCommands = new Map(); // Map<string, Promise>

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 menit default

/**
 * Generate connection key berdasarkan device credentials (host+user+password+port)
 * Ini memungkinkan device yang sama (IP sama) di-share antar workspace
 */
function generateDeviceConnectionKey(host, user, password, port) {
    // Buat hash dari credentials untuk key yang unik
    const credentials = `${host}:${port}:${user}:${password || ''}`;
    const hash = crypto.createHash('md5').update(credentials).digest('hex');
    return `device-${hash}`;
}

/**
 * Get device connection key dari deviceId
 */
async function getDeviceConnectionKey(deviceId, workspaceId = null) {
    let query = 'SELECT host, user, password, port FROM mikrotik_devices WHERE id = ?';
    let params = [deviceId];

    if (workspaceId) {
        query += ' AND workspace_id = ?';
        params.push(workspaceId);
    }

    const [devices] = await pool.query(query, params);
    if (devices.length === 0) {
        throw new Error(`Perangkat dengan ID ${deviceId} tidak ditemukan${workspaceId ? ` untuk workspace ini` : ''}.`);
    }

    const device = devices[0];
    return generateDeviceConnectionKey(device.host, device.user, device.password, device.port);
}

async function getOrCreateConnection(workspaceId, timeout, customKey = null, deviceId = null) {
    // Jika deviceId tidak diberikan, gunakan active_device_id (backward compatibility)
    if (!deviceId) {
        const [workspaces] = await pool.query('SELECT active_device_id FROM workspaces WHERE id = ?', [workspaceId]);
        if (!workspaces[0]?.active_device_id) {
            throw new Error(`Tidak ada perangkat aktif yang terkonfigurasi untuk workspace ini.`);
        }
        deviceId = workspaces[0].active_device_id;
    }

    // Generate device-based connection key (bukan workspace-based)
    const deviceConnectionKey = await getDeviceConnectionKey(deviceId, workspaceId);

    // Gunakan customKey jika diberikan (untuk backward compatibility), atau device-based key
    const connectionKey = customKey || deviceConnectionKey;

    // STEP 1: Cek apakah koneksi sudah ada dan connected
    let connection = getConnection(connectionKey);
    if (connection && connection.client && connection.client.connected) {
        // Gunakan timeout yang diminta jika diberikan dan valid, atau gunakan yang sudah ada
        // Pastikan timeout tidak null, undefined, atau 0
        const effectiveTimeout = (timeout && timeout > 0) ? timeout : (connection.timeout || DEFAULT_IDLE_TIMEOUT);

        // Update timeout di connection object
        connection.timeout = effectiveTimeout;

        // Reset timeout dengan nilai efektif (ini akan reset timer idle)
        setIdleTimeout(connectionKey, connection, effectiveTimeout);

        return connection.client;
    }

    // STEP 2: Cek apakah ada koneksi yang sedang dibuat (ada lock)
    // Jika ada, tunggu koneksi tersebut selesai dibuat dengan timeout
    if (isConnectionLocked(connectionKey)) {
        console.log(`[Connection] Menunggu koneksi ${connectionKey} yang sedang dibuat oleh request lain...`);
        return new Promise((resolve, reject) => {
            // Tunggu lock selesai dengan timeout 10 detik
            const lockTimeout = setTimeout(() => {
                // Timeout menunggu lock, cek apakah koneksi sudah ada
                const existingConnection = getConnection(connectionKey);
                if (existingConnection && existingConnection.client && existingConnection.client.connected) {
                    console.log(`[Connection] Timeout menunggu lock, tapi koneksi ${connectionKey} sudah ada, menggunakan yang ada`);
                    resolve(existingConnection.client);
                } else {
                    console.warn(`[Connection] Timeout menunggu lock untuk ${connectionKey}, akan membuat koneksi baru`);
                    // Clear lock yang hang
                    clearConnectionLock(connectionKey);
                    // Fall through ke STEP 3 dengan membuat koneksi baru
                    reject(new Error('Lock timeout, akan retry dengan koneksi baru'));
                }
            }, 10000); // 10 detik timeout untuk menunggu lock

            // Tunggu lock selesai
            const lockPromise = getConnectionLock(connectionKey);
            if (lockPromise) {
                lockPromise
                    .then((client) => {
                        clearTimeout(lockTimeout);
                        // Lock promise sudah resolve dengan client, langsung return
                        resolve(client);
                    })
                    .catch((error) => {
                        clearTimeout(lockTimeout);
                        // Jika lock promise reject, cek lagi apakah koneksi sudah ada (mungkin dibuat oleh request lain)
                        const existingConnection = getConnection(connectionKey);
                        if (existingConnection && existingConnection.client && existingConnection.client.connected) {
                            console.log(`[Connection] Koneksi ${connectionKey} berhasil dibuat oleh request lain setelah error`);
                            resolve(existingConnection.client);
                        } else {
                            // Jika masih belum ada, reject dan caller akan retry
                            reject(error);
                        }
                    });
            } else {
                clearTimeout(lockTimeout);
                // Lock hilang, coba lagi dengan membuat koneksi baru
                console.log(`[Connection] Lock hilang untuk ${connectionKey}, akan membuat koneksi baru`);
                // Fall through ke STEP 3
                reject(new Error('Lock tidak ditemukan, akan membuat koneksi baru'));
            }
        }).catch((error) => {
            // Jika error, coba sekali lagi dengan double-check
            const existingConnection = getConnection(connectionKey);
            if (existingConnection && existingConnection.client && existingConnection.client.connected) {
                return existingConnection.client;
            }
            // Jika masih error, lanjutkan ke STEP 3 untuk membuat koneksi baru
            throw error;
        });
    }

    // STEP 3: Buat koneksi baru dengan locking mechanism
    // Set lock untuk mencegah multiple requests membuat koneksi bersamaan
    let client; // Declare di luar untuk bisa diakses di catch block
    const createConnectionPromise = (async () => {
        try {
            // Double-check: cek lagi apakah koneksi sudah dibuat oleh request lain
            connection = getConnection(connectionKey);
            if (connection && connection.client && connection.client.connected) {
                console.log(`[Connection] Koneksi ${connectionKey} sudah dibuat oleh request lain, menggunakan yang ada`);
                return connection.client;
            }

            const [devices] = await pool.query('SELECT * FROM mikrotik_devices WHERE id = ? AND workspace_id = ?', [deviceId, workspaceId]);
            if (devices.length === 0) throw new Error(`Perangkat dengan ID ${deviceId} tidak ditemukan untuk workspace ini.`);

            const device = devices[0];
            const connectionOptions = {
                host: device.host,
                user: device.user,
                port: device.port,
                keepalive: true
            };
            if (device.password) {
                connectionOptions.password = device.password;
            }

            client = new RouterOSAPI(connectionOptions);

            // Tambahkan error handler yang lebih baik - tidak langsung hapus koneksi untuk timeout
            let errorCount = 0;
            const MAX_ERROR_COUNT = 3; // Hapus koneksi setelah 3 error berturut-turut

            client.on('error', (error) => {
                // Jangan hapus koneksi untuk !empty, ini bukan error fatal
                if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
                    console.debug(`[RouterOS API] Query kosong pada koneksi ${connectionKey} - ini normal.`);
                    return;
                }

                errorCount++;
                console.error(`[RouterOS API Error] Error pada koneksi ${connectionKey} (${errorCount}/${MAX_ERROR_COUNT}):`, error.message || error);

                // Hanya hapus koneksi jika error terjadi berulang kali atau error fatal
                // Timeout tunggal tidak langsung menghapus koneksi
                if (error.message?.includes('not connected') ||
                    error.message?.includes('connection closed') ||
                    error.message?.includes('ECONNREFUSED') ||
                    error.message?.includes('ENOTFOUND') ||
                    errorCount >= MAX_ERROR_COUNT) {
                    console.warn(`[RouterOS API] Menghapus koneksi ${connectionKey} karena error fatal atau terlalu banyak error`);
                    removeConnection(connectionKey);
                } else {
                    // Untuk timeout atau error sementara, coba reconnect tanpa menghapus koneksi
                    console.warn(`[RouterOS API] Error sementara pada koneksi ${connectionKey}, tidak menghapus koneksi`);
                }
            });

            console.log(`[Connection] Membuat koneksi baru untuk ${connectionKey}...`);
            await client.connect();
            // Pastikan timeout tidak null atau 0 - gunakan default jika tidak ada
            const effectiveTimeout = (timeout && timeout > 0) ? timeout : DEFAULT_IDLE_TIMEOUT;
            addConnection(connectionKey, { client }, effectiveTimeout);
            console.log(`[Connection] Koneksi ${connectionKey} berhasil dibuat`);
            return client;
        } catch (error) {
            console.error(`[RouterOS API] Gagal membuat koneksi untuk ${connectionKey}:`, error.message);
            // Pastikan koneksi ditutup jika gagal
            try {
                if (client && client.connected) {
                    await client.close();
                }
            } catch (closeError) {
                // Ignore close error
            }
            // Clear lock dan reject semua pending requests
            removeConnection(connectionKey); // Ini akan handle pending requests juga
            throw error;
        }
    })();

    // Set lock
    setConnectionLock(connectionKey, createConnectionPromise);

    try {
        const client = await createConnectionPromise;
        return client;
    } finally {
        // Lock akan di-clear di addConnection atau removeConnection
    }
}

/**
 * Wrapper untuk client.write() dengan timeout
 */
function writeWithTimeout(client, command, params, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        let timeoutId = null;
        let isResolved = false;

        // Cek apakah client masih connected sebelum write
        if (!client || !client.connected) {
            reject(new Error('Koneksi tidak valid atau terputus'));
            return;
        }

        // Set timeout
        timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                console.warn(`[API Command] Timeout setelah ${timeoutMs}ms untuk command "${command}"`);
                reject(new Error(`Command timeout setelah ${timeoutMs}ms`));
            }
        }, timeoutMs);

        // Jalankan command
        client.write(command, params)
            .then((result) => {
                if (!isResolved) {
                    isResolved = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(result);
                }
            })
            .catch((error) => {
                if (!isResolved) {
                    isResolved = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    reject(error);
                }
            });
    });
}

/**
 * Cek apakah sebuah command aman untuk di-retry otomatis.
 * Command yang memodifikasi data (add, set, remove) TIDAK aman untuk di-retry pada timeout
 * karena router mungkin sudah memprosesnya. Command query (print, get, monitor) aman untuk di-retry.
 */
function isSafeToRetry(command) {
    if (!command) return false;
    const lowerCommand = command.toLowerCase();

    // Command mutasi data yang berisiko jika di-retry pada timeout
    if (lowerCommand.includes('/add') ||
        lowerCommand.includes('/set') ||
        lowerCommand.includes('/remove') ||
        lowerCommand.includes('/reset')) {
        return false;
    }

    // Command pembacaan yang aman di-retry
    if (lowerCommand.includes('/print') ||
        lowerCommand.includes('/get') ||
        lowerCommand.includes('/monitor') ||
        lowerCommand.includes('/stats')) {
        return true;
    }

    // Default: anggap tidak aman kecuali dikenal sebagai query
    return false;
}

async function runCommandForWorkspace(workspaceId, command, params = [], deviceId = null, options = {}) {
    if (!workspaceId) throw new Error('Workspace tidak valid.');

    // Jika deviceId tidak diberikan, gunakan active_device_id
    if (!deviceId) {
        const [workspaces] = await pool.query('SELECT active_device_id FROM workspaces WHERE id = ?', [workspaceId]);
        if (!workspaces[0]?.active_device_id) {
            throw new Error(`Tidak ada perangkat aktif yang terkonfigurasi untuk workspace ini.`);
        }
        deviceId = workspaces[0].active_device_id;
    }

    const deviceConnectionKey = await getDeviceConnectionKey(deviceId, workspaceId);
    let client = null;
    let retryCount = 0;
    const maxRetries = options.noRetry ? 0 : 2;

    // PHASE 1: Mendapatkan koneksi yang valid (Boleh retry)
    console.log(`[API-ROBUST] [PHASE 1] Memulai akuisisi koneksi untuk workspace ${workspaceId}...`);
    while (retryCount <= maxRetries) {
        try {
            client = await getOrCreateConnection(workspaceId, DEFAULT_IDLE_TIMEOUT, null, deviceId);
            if (client && client.connected) break;

            console.warn(`[API Connection] Koneksi tidak valid (attempt ${retryCount + 1}), mencoba reconnect...`);
            removeConnection(deviceConnectionKey);
            retryCount++;
            if (retryCount > maxRetries) throw new Error('Gagal mendapatkan koneksi setelah beberapa percobaan');
            await new Promise(res => setTimeout(res, 500));
        } catch (error) {
            console.error(`[API Connection Error] Gagal mendapatkan koneksi (attempt ${retryCount + 1}):`, error.message);
            removeConnection(deviceConnectionKey);
            retryCount++;
            if (retryCount > maxRetries) throw error;
            await new Promise(res => setTimeout(res, 1000));
        }
    }

    // PHASE 2: Eksekusi Command
    const isSafe = isSafeToRetry(command);
    // Gunakan timeout lebih panjang untuk mutasi (60s), query tetap 30s
    const timeoutMs = options.timeout || (isSafe ? 30000 : 60000);
    // deduplication key: connection + command + params
    const commandKey = `${deviceConnectionKey}:${command}:${JSON.stringify(params)}`;

    // Dedup: Jika command pembacaan yang sama sedang berjalan, gunakan promise yang ada
    if (isSafe && pendingReadCommands.has(commandKey)) {
        console.log(`[API-DEDUP] Menggunakan hasil command yang sedang berjalan: "${command}"`);
        return pendingReadCommands.get(commandKey);
    }

    // CRITICAL: Reset retryCount untuk fase eksekusi perintah
    let executionRetryCount = 0;

    console.log(`[API-ROBUST] [PHASE 2] Memulai eksekusi command "${command}"...`);
    const executeAndCleanup = (async () => {
        try {
            while (executionRetryCount <= maxRetries) {
                const startTime = Date.now();
                try {
                    console.log(`[API Command] [START] "${command}" pada ${deviceConnectionKey} (Timeout: ${timeoutMs}ms)`);
                    const result = await writeWithTimeout(client, command, params, timeoutMs);
                    console.log(`[API Command] [SUCCESS] "${command}" selesai dalam ${Date.now() - startTime}ms`);
                    return result;
                } catch (error) {
                    const duration = Date.now() - startTime;
                    console.warn(`[API-ROBUST] [ERROR] "${command}" gagal setelah ${duration}ms: ${error.message}`);

                    // Hanya hapus koneksi jika ini perintah mutasi (unsafe) atau retry sudah habis
                    // Ini untuk mencegah monitoring rutin membunuh koneksi yang sedang dipakai perintah /add atau /remove
                    if (!isSafe || executionRetryCount >= maxRetries) {
                        console.log(`[API-ROBUST] Membersihkan koneksi ${deviceConnectionKey} karena error/timeout.`);
                        removeConnection(deviceConnectionKey);
                    }

                    const isTimeout = error.message?.includes('timeout');
                    if (!isSafe || options.noRetry) {
                        if (isTimeout) {
                            throw new Error(`Perintah MikroTik timeout (${timeoutMs}ms). Router mungkin sedang lag. Silakan periksa data atau segarkan halaman untuk memastikan.`);
                        }
                        throw error;
                    }

                    if (isTimeout || error.message?.includes('tidak valid') || error.message?.includes('terputus') || error.errno === 'UNKNOWNREPLY') {
                        executionRetryCount++;
                        if (executionRetryCount > maxRetries) break;
                        try {
                            client = await getOrCreateConnection(workspaceId, DEFAULT_IDLE_TIMEOUT, null, deviceId);
                        } catch (e) { break; }
                        await new Promise(res => setTimeout(res, 1000));
                        continue;
                    }
                    throw error;
                }
            }
            throw new Error(`Gagal menjalankan command "${command}" setelah beberapa percobaan.`);
        } finally {
            if (isSafe) pendingReadCommands.delete(commandKey);
        }
    })();

    if (isSafe) {
        pendingReadCommands.set(commandKey, executeAndCleanup);
    }

    return executeAndCleanup;
}

module.exports = { runCommandForWorkspace, getOrCreateConnection, getDeviceConnectionKey };
