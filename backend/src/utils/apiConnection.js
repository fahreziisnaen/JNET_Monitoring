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

async function runCommandForWorkspace(workspaceId, command, params = [], deviceId = null) {
    if (!workspaceId) throw new Error('Workspace tidak valid.');
    
    // Jika deviceId tidak diberikan, gunakan active_device_id (backward compatibility)
    if (!deviceId) {
        const [workspaces] = await pool.query('SELECT active_device_id FROM workspaces WHERE id = ?', [workspaceId]);
        if (!workspaces[0]?.active_device_id) {
            throw new Error(`Tidak ada perangkat aktif yang terkonfigurasi untuk workspace ini.`);
        }
        deviceId = workspaces[0].active_device_id;
    }
    
    // Get device-based connection key
    const deviceConnectionKey = await getDeviceConnectionKey(deviceId, workspaceId);
    
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
    try {
        // Gunakan DEFAULT_IDLE_TIMEOUT untuk memastikan koneksi tidak ditutup terlalu cepat
        // Ini memungkinkan koneksi di-reuse untuk request berikutnya
        const client = await getOrCreateConnection(workspaceId, DEFAULT_IDLE_TIMEOUT, null, deviceId);
        
        // Cek apakah koneksi masih valid
        if (!client || !client.connected) {
                console.warn(`[API Command] Koneksi tidak valid (attempt ${retryCount + 1}), mencoba reconnect...`);
            removeConnection(deviceConnectionKey);
                retryCount++;
                if (retryCount > maxRetries) {
                    throw new Error('Gagal mendapatkan koneksi yang valid setelah beberapa percobaan');
                }
                // Tunggu sebentar sebelum retry
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }
            
            // Gunakan writeWithTimeout dengan timeout 25 detik (sama dengan frontend timeout)
            // Untuk device dengan banyak secrets (100+), butuh waktu lebih lama
            console.log(`[API Command] Menjalankan "${command}" untuk workspace ${workspaceId}, device ${deviceId}`);
            const result = await writeWithTimeout(client, command, params, 25000);
            console.log(`[API Command] Berhasil menjalankan "${command}"`);
            return result;
            
    } catch (error) {
        // Handle error !empty - ini bukan error fatal, hanya indikasi hasil kosong
        if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
            // Return empty array untuk !empty reply
            console.debug(`[API Command] Query kosong untuk "${command}" - ini normal, bukan error.`);
            return [];
        }
            
            // Handle timeout atau connection error
            if (error.message?.includes('timeout') || error.message?.includes('tidak valid') || error.message?.includes('terputus')) {
                console.warn(`[API Command Error] Koneksi bermasalah untuk ${deviceConnectionKey} (attempt ${retryCount + 1}):`, error.message);
                removeConnection(deviceConnectionKey);
                retryCount++;
                
                if (retryCount > maxRetries) {
                    console.error(`[API Command Error] Gagal setelah ${maxRetries + 1} percobaan untuk "${command}"`);
                    throw new Error(`Gagal menjalankan command setelah beberapa percobaan: ${error.message}`);
                }
                
                // Tunggu sebentar sebelum retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
        
        // Jika error adalah UNKNOWNREPLY selain !empty atau error koneksi, hapus koneksi dari cache
        if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY')) {
            // Jangan hapus koneksi untuk !empty, hanya untuk error lain
            if (!error.message?.includes('!empty')) {
                console.warn(`[API Command Error] Koneksi bermasalah untuk ${deviceConnectionKey}, menghapus dari cache.`);
                removeConnection(deviceConnectionKey);
            }
        } else if (error.message?.includes('not connected') || error.message?.includes('connection')) {
            console.warn(`[API Command Error] Koneksi terputus untuk ${deviceConnectionKey}, menghapus dari cache.`);
            removeConnection(deviceConnectionKey);
        }
        
        console.error(`[API Command Error] Gagal menjalankan "${command}" untuk workspace ${workspaceId}, device ${deviceId}:`, error.message || error);
        throw error;
        }
    }
}

module.exports = { runCommandForWorkspace, getOrCreateConnection, getDeviceConnectionKey };

module.exports = { runCommandForWorkspace, getOrCreateConnection };