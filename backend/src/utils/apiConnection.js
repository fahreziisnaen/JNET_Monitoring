const pool = require('../config/database');
const RouterOSAPI = require('node-routeros').RouterOSAPI;
const crypto = require('crypto');
const { getConnection, addConnection, removeConnection, setIdleTimeout } = require('../services/connectionManager');

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
    let connection = getConnection(connectionKey);

    if (connection && connection.client && connection.client.connected) {
        // Gunakan timeout yang diminta jika diberikan, atau gunakan yang sudah ada
        // Untuk cron jobs yang menggunakan timeout lebih lama, pastikan timeout di-update
        const effectiveTimeout = timeout !== null && timeout !== undefined ? timeout : (connection.timeout || DEFAULT_IDLE_TIMEOUT);
        
        // Update timeout di connection object
        connection.timeout = effectiveTimeout;
        
        // Reset timeout dengan nilai efektif (ini akan reset timer idle)
        // Ini penting untuk memastikan koneksi tidak ditutup selama masih digunakan
        setIdleTimeout(connectionKey, connection, effectiveTimeout);
        
        return connection.client;
    }
    
    const [devices] = await pool.query('SELECT * FROM mikrotik_devices WHERE id = ? AND workspace_id = ?', [deviceId, workspaceId]);
    if (devices.length === 0) throw new Error(`Perangkat dengan ID ${deviceId} tidak ditemukan untuk workspace ini.`);
    
    const device = devices[0];
    const connectionOptions = {
        host: device.host, user: device.user, port: device.port, keepalive: true
    };
    if (device.password) {
        connectionOptions.password = device.password;
    }

    const client = new RouterOSAPI(connectionOptions);
    
    // Tambahkan error handler untuk menangkap error yang tidak terduga
    client.on('error', (error) => {
        // Jangan hapus koneksi untuk !empty, ini bukan error fatal
        if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
            console.debug(`[RouterOS API] Query kosong pada koneksi ${connectionKey} - ini normal.`);
            return; // Jangan hapus koneksi untuk !empty
        }
        console.error(`[RouterOS API Error] Error pada koneksi ${connectionKey}:`, error.message || error);
        // Hapus koneksi dari cache jika terjadi error selain !empty
        removeConnection(connectionKey);
    });

    try {
        await client.connect();
        addConnection(connectionKey, { client }, timeout);
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
        throw error;
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
        const client = await getOrCreateConnection(workspaceId, null, null, deviceId);
        
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
            
            // Gunakan writeWithTimeout dengan timeout 12 detik
            console.log(`[API Command] Menjalankan "${command}" untuk workspace ${workspaceId}, device ${deviceId}`);
            const result = await writeWithTimeout(client, command, params, 12000);
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