const pool = require('../config/database');
const { runCommandForWorkspace, getOrCreateConnection, getDeviceConnectionKey} = require('../utils/apiConnection');
const { sendWhatsAppMessage, getWorkspaceWhatsAppTarget } = require('../services/whatsappService');
const crypto = require('crypto');

/**
 * Format durasi dalam detik menjadi format "x hari x jam x menit x detik"
 * @param {number} totalSeconds - Total durasi dalam detik
 * @returns {string} - Durasi yang sudah diformat
 */
function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds < 0) {
        return '0 detik';
    }
    
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0) parts.push(`${minutes} menit`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} detik`);
    
    return parts.join(' ');
}

const alarmState = new Map();
const lastTrafficData = new Map();

async function checkAlarms(workspaceId, device) {
    if (!alarmState.has(workspaceId)) {
        alarmState.set(workspaceId, { cpuCooldown: 0, offlineCooldown: 0 });
    }
    const state = alarmState.get(workspaceId);
    const now = Date.now();

    // Ambil WhatsApp target (group atau individual) dari workspace
    const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
    if (!whatsappTarget) return;

    try {
        const [resource] = await runCommandForWorkspace(workspaceId, '/system/resource/print');
        if (state.offlineCooldown !== 0) {
             const message = `✅ *PERANGKAT ONLINE* ✅\n\nKoneksi ke perangkat *${device.name}* telah pulih.`;
             await sendWhatsAppMessage(whatsappTarget, message);
             state.offlineCooldown = 0;
        }

        const [alarms] = await pool.query('SELECT * FROM alarms WHERE workspace_id = ? AND type = "CPU_LOAD"', [workspaceId]);
        if (alarms.length > 0 && state.cpuCooldown < now) {
            const cpuLoad = parseInt(resource['cpu-load'], 10) || 0;
            if (cpuLoad > alarms[0].threshold_mbps) {
                const message = `🚨 *ALARM CPU TINGGI* 🚨\n\nPerangkat *${device.name}* mengalami lonjakan CPU mencapai *${cpuLoad}%*. Segera periksa kondisi perangkat Anda!`;
                await sendWhatsAppMessage(whatsappTarget, message);
                state.cpuCooldown = now + 15 * 60 * 1000;
            }
        }
    } catch (error) {
        if (state.offlineCooldown < now) {
            const [alarms] = await pool.query('SELECT * FROM alarms WHERE workspace_id = ? AND type = "DEVICE_OFFLINE"', [workspaceId]);
            if (alarms.length > 0) {
                const message = `🚫 *PERANGKAT OFFLINE* 🚫\n\nAplikasi tidak dapat terhubung ke perangkat *${device.name}* (${device.host}). Silakan periksa koneksi atau kondisi perangkat.`;
                await sendWhatsAppMessage(whatsappTarget, message);
                state.offlineCooldown = now + 30 * 60 * 1000;
            }
        }
    }
    alarmState.set(workspaceId, state);
}

async function processSlaEvents(workspaceId, currentActiveUsers, deviceId = null, broadcastCallback = null) {
    const dbConnection = await pool.getConnection();
    try {
        const [usersFromDb] = await dbConnection.query('SELECT pppoe_user, is_active FROM pppoe_user_status WHERE workspace_id = ?', [workspaceId]);
        const dbStatusMap = new Map(usersFromDb.map(u => [u.pppoe_user, u.is_active]));
        const currentActiveUserSet = new Set(currentActiveUsers.map(u => u.name));

        for (const user of usersFromDb) {
            if (user.is_active && !currentActiveUserSet.has(user.pppoe_user)) {
                const [openEvents] = await dbConnection.query('SELECT id FROM downtime_events WHERE workspace_id = ? AND pppoe_user = ? AND end_time IS NULL', [workspaceId, user.pppoe_user]);
                if (openEvents.length === 0) {
                    await dbConnection.query('INSERT INTO downtime_events (workspace_id, pppoe_user, start_time) VALUES (?, ?, NOW())', [workspaceId, user.pppoe_user]);
                }
                await dbConnection.query('UPDATE pppoe_user_status SET is_active = FALSE WHERE workspace_id = ? AND pppoe_user = ?', [workspaceId, user.pppoe_user]);
            }
        }

        const reconnectedUsers = [];
        const reconnectDurations = [];

        for (const user of currentActiveUserSet) {
            const lastDbStatus = dbStatusMap.get(user);
            
            // Cek apakah ada downtime event yang masih open untuk user ini
            const [openDowntimeEvents] = await dbConnection.query(
                `SELECT id, start_time, notification_sent FROM downtime_events 
                 WHERE workspace_id = ? AND pppoe_user = ? AND end_time IS NULL 
                 ORDER BY start_time DESC LIMIT 1`,
                [workspaceId, user]
            );
            
            // Jika user sekarang aktif dan ada downtime event yang masih open, tutup event tersebut
            if (openDowntimeEvents.length > 0) {
                const openEvent = openDowntimeEvents[0];
                const [updateResult] = await dbConnection.query(
                    `UPDATE downtime_events 
                     SET end_time = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW()) 
                     WHERE id = ?`,
                    [openEvent.id]
                );
                
                // Jika berhasil update, ambil data event untuk notifikasi
                // Kirim notifikasi reconnect jika event tersebut sudah pernah dikirim disconnect notification
                // (notification_sent = TRUE berarti sudah pernah dikirim disconnect notification setelah 2 menit)
                if (updateResult.affectedRows > 0) {
                    const [eventData] = await dbConnection.query(
                        `SELECT duration_seconds, notification_sent FROM downtime_events WHERE id = ?`,
                        [openEvent.id]
                    );
                    
                    // Kirim reconnect notification jika:
                    // 1. Event sudah pernah dikirim disconnect notification (notification_sent = TRUE)
                    //    ATAU
                    // 2. Durasi downtime >= 2 menit (untuk kasus edge case dimana notification_sent belum diupdate)
                    if (eventData.length > 0 && eventData[0].duration_seconds) {
                        const shouldNotify = eventData[0].notification_sent === 1 || eventData[0].duration_seconds >= 120;
                        
                        if (shouldNotify) {
                        reconnectedUsers.push(user);
                        reconnectDurations.push(eventData[0].duration_seconds);
                        }
                    }
                }
            }
            
            // Update status user menjadi aktif
            await dbConnection.query(
                `INSERT INTO pppoe_user_status (workspace_id, pppoe_user, is_active, last_seen_active) 
                 VALUES (?, ?, TRUE, NOW()) 
                 ON DUPLICATE KEY UPDATE is_active = TRUE, last_seen_active = NOW()`, 
                [workspaceId, user]
            );
        }
        
        // Kirim notifikasi reconnect jika ada user yang reconnect
        // Hanya kirim jika downtime sebelumnya >= 2 menit (konsisten dengan disconnect notification)
        if (reconnectedUsers.length > 0) {
            try {
                // Ambil WhatsApp target (group atau individual) dari workspace
                const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
                
                if (whatsappTarget) {
                    const reconnectTime = new Date().toLocaleString('id-ID');
                    let message = `✅ *PPPoE User Reconnected* ✅\n\n`;
                    message += `Waktu: ${reconnectTime}\n\n`;
                    
                    if (reconnectedUsers.length === 1) {
                        message += `User yang reconnect:\n`;
                        message += `• *${reconnectedUsers[0]}*\n`;
                        if (reconnectDurations[0]) {
                            message += `Durasi downtime: ${formatDuration(reconnectDurations[0])}\n`;
                        }
                    } else {
                        message += `User yang reconnect (${reconnectedUsers.length}):\n`;
                        reconnectedUsers.forEach((user, index) => {
                            message += `${index + 1}. *${user}*`;
                            if (reconnectDurations[index]) {
                                message += ` (${formatDuration(reconnectDurations[index])})`;
                            }
                            message += `\n`;
                        });
                    }
                    message += `\nKoneksi telah pulih. User dapat menggunakan layanan kembali.`;
                    
                    await sendWhatsAppMessage(whatsappTarget, message);
                }

                // Broadcast notifikasi reconnect ke WebSocket clients untuk toast notification di frontend
                if (broadcastCallback) {
                    try {
                        const reconnectNotifications = reconnectedUsers.map((user, index) => ({
                            userName: user,
                            duration: reconnectDurations[index],
                            reconnectTime: new Date().toISOString()
                        }));
                        
                        broadcastCallback(workspaceId, {
                            type: 'reconnect-notification',
                            payload: {
                                notifications: reconnectNotifications,
                                timestamp: new Date().toISOString()
                            }
                        });
                    } catch (wsError) {
                        console.error(`[SLA Events] Error broadcasting reconnect ke WebSocket untuk workspace ${workspaceId}:`, wsError.message);
                    }
                }
            } catch (notifError) {
                console.error(`[SLA Events] Error sending reconnect notification untuk workspace ${workspaceId}:`, notifError.message);
            }
        }
    } finally {
        dbConnection.release();
    }
}

/**
 * Kirim notifikasi disconnect untuk downtime events yang sudah lebih dari 2 menit
 * dan belum dikirim notifikasi sebelumnya
 * @param {Function} broadcastCallback - Optional callback untuk broadcast ke WebSocket clients
 */
async function sendDowntimeNotifications(broadcastCallback = null) {
    try {
        // Cari semua downtime events yang:
        // 1. Masih open (end_time IS NULL)
        // 2. Sudah lebih dari 2 menit sejak start_time
        // 3. Belum dikirim notifikasi (notification_sent = FALSE)
        const [downtimeEvents] = await pool.query(
            `SELECT de.id, de.workspace_id, de.pppoe_user, de.start_time,
                    TIMESTAMPDIFF(SECOND, de.start_time, NOW()) as duration_seconds,
                    w.name as workspace_name
             FROM downtime_events de
             JOIN workspaces w ON de.workspace_id = w.id
             WHERE de.end_time IS NULL 
             AND de.notification_sent = FALSE
             AND TIMESTAMPDIFF(SECOND, de.start_time, NOW()) >= 120
             ORDER BY de.start_time ASC`
        );

        if (downtimeEvents.length === 0) {
            return; // Tidak ada downtime yang perlu dikirim notifikasi
        }

        // Group by workspace_id untuk mengirim notifikasi per workspace
        const workspaceGroups = new Map();
        for (const event of downtimeEvents) {
            if (!workspaceGroups.has(event.workspace_id)) {
                workspaceGroups.set(event.workspace_id, {
                    workspace_name: event.workspace_name,
                    events: []
                });
            }
            workspaceGroups.get(event.workspace_id).events.push(event);
        }

        // Kirim notifikasi untuk setiap workspace
        for (const [workspaceId, group] of workspaceGroups) {
            try {
                const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
                
                if (!whatsappTarget) {
                    // Skip jika tidak ada WhatsApp target, tapi tetap mark sebagai sent
                    const eventIds = group.events.map(e => e.id);
                    if (eventIds.length > 0) {
                        const placeholders = eventIds.map(() => '?').join(',');
                        await pool.query(
                            `UPDATE downtime_events SET notification_sent = TRUE WHERE id IN (${placeholders})`,
                            eventIds
                        );
                    }
                    continue;
                }

                const disconnectTime = new Date().toLocaleString('id-ID');
                let message = `🚨 *PPPoE User Disconnected* 🚨\n\n`;
                message += `Workspace: *${group.workspace_name}*\n`;
                message += `Waktu: ${disconnectTime}\n\n`;

                if (group.events.length === 1) {
                    const event = group.events[0];
                    message += `User yang disconnect:\n`;
                    message += `• *${event.pppoe_user}*\n`;
                    message += `Durasi downtime: ${formatDuration(event.duration_seconds)}\n\n`;
                } else {
                    message += `User yang disconnect (${group.events.length}):\n`;
                    group.events.forEach((event, index) => {
                        message += `${index + 1}. *${event.pppoe_user}* (${formatDuration(event.duration_seconds)})\n`;
                    });
                    message += `\n`;
                }

                message += `Silakan periksa kondisi jaringan atau hubungi user terkait.`;

                // Kirim notifikasi WhatsApp
                await sendWhatsAppMessage(whatsappTarget, message);

                // Broadcast notifikasi ke WebSocket clients untuk toast notification di frontend
                if (broadcastCallback) {
                    try {
                        const disconnectNotifications = group.events.map(event => ({
                            userName: event.pppoe_user,
                            duration: event.duration_seconds,
                            startTime: event.start_time
                        }));
                        
                        broadcastCallback(workspaceId, {
                            type: 'downtime-notification',
                            payload: {
                                notifications: disconnectNotifications,
                                timestamp: new Date().toISOString()
                            }
                        });
                    } catch (wsError) {
                        console.error(`[Downtime Notification] Error broadcasting ke WebSocket untuk workspace ${workspaceId}:`, wsError.message);
                    }
                }

                // Mark semua events sebagai notification_sent
                const eventIds = group.events.map(e => e.id);
                if (eventIds.length > 0) {
                    const placeholders = eventIds.map(() => '?').join(',');
                    await pool.query(
                        `UPDATE downtime_events SET notification_sent = TRUE WHERE id IN (${placeholders})`,
                        eventIds
                    );
                }

                console.log(`[Downtime Notification] Mengirim notifikasi disconnect untuk ${group.events.length} user di workspace ${workspaceId}`);
            } catch (error) {
                console.error(`[Downtime Notification] Error mengirim notifikasi untuk workspace ${workspaceId}:`, error.message);
                // Jangan mark sebagai sent jika gagal kirim, biar bisa dicoba lagi
            }
        }
    } catch (error) {
        console.error('[Downtime Notification] Error fatal:', error);
    }
}

/**
 * Group devices berdasarkan credentials (host+user+password+port)
 * Device dengan credentials yang sama akan di-group bersama
 */
async function groupDevicesByCredentials() {
    const [devices] = await pool.query(`
        SELECT d.id as device_id, d.workspace_id, d.host, d.user, d.password, d.port
        FROM mikrotik_devices d
        JOIN workspaces w ON d.workspace_id = w.id
    `);
    
    // Group devices berdasarkan credentials
    const deviceGroups = new Map();
    
    for (const device of devices) {
        const credentials = `${device.host}:${device.port}:${device.user}:${device.password || ''}`;
        const groupKey = crypto.createHash('md5').update(credentials).digest('hex');
        
        if (!deviceGroups.has(groupKey)) {
            deviceGroups.set(groupKey, {
                credentials: { host: device.host, user: device.user, password: device.password, port: device.port },
                devices: []
            });
        }
        
        deviceGroups.get(groupKey).devices.push({
            device_id: device.device_id,
            workspace_id: device.workspace_id
        });
    }
    
    return deviceGroups;
}

/**
 * Monitoring SLA & Notifikasi yang berjalan terus menerus
 * Tidak bergantung pada user login via WebSocket
 * Berjalan setiap 3 detik untuk update SLA dan trigger notifikasi
 * OPTIMIZED: Polling sekali per device fisik, share hasil ke semua workspace
 * @param {Function} broadcastCallback - Optional callback untuk broadcast ke WebSocket clients
 */
async function monitorSlaAndNotifications(broadcastCallback = null) {
    try {
        // Group devices berdasarkan credentials
        const deviceGroups = await groupDevicesByCredentials();
        
        // Polling sekali per device fisik
        for (const [groupKey, group] of deviceGroups) {
            if (group.devices.length === 0) continue;
            
            // Gunakan device pertama dari group sebagai representasi
            const firstDevice = group.devices[0];
            
            try {
                // Gunakan timeout lebih lama untuk cron jobs (10 menit)
                // Karena cron job berjalan setiap 3 detik, koneksi akan selalu digunakan
                // Jadi tidak perlu ditutup setelah 30 detik
                const CRON_TIMEOUT = 10 * 60 * 1000; // 10 menit timeout untuk cron jobs
                const client = await getOrCreateConnection(firstDevice.workspace_id, CRON_TIMEOUT, null, firstDevice.device_id);
                
                // Cek apakah client terhubung
                if (!client || !client.connected) {
                    continue; // Skip jika tidak terhubung
                }
                
                // Ambil PPPoE active users (polling sekali)
                let pppoeActive = [];
                try {
                    pppoeActive = await client.write('/ppp/active/print');
                    if (!Array.isArray(pppoeActive)) {
                        pppoeActive = [];
                    }
                } catch (err) {
                    // Handle !empty reply - ini normal jika tidak ada user aktif
                    if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                        pppoeActive = [];
                    } else {
                        // Error lain, log dan skip group ini
                        console.warn(`[SLA Monitor] Error mengambil PPPoE active untuk device group ${groupKey}:`, err.message);
                        continue;
                    }
                }
                
                // Share hasil ke semua workspace yang menggunakan device ini
                for (const device of group.devices) {
                    try {
                        await processSlaEvents(device.workspace_id, pppoeActive, device.device_id, broadcastCallback);
                    } catch (error) {
                        console.error(`[SLA Monitor] Gagal memproses SLA events untuk workspace ${device.workspace_id}, device ${device.device_id}:`, error.message);
                    }
                }
                
            } catch (error) {
                // Handle error dengan lebih baik, jangan crash aplikasi
                if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY')) {
                    // !empty bukan error fatal
                    if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
                        continue; // Skip, ini normal
                    }
                    console.warn(`[SLA Monitor] Error UNKNOWNREPLY untuk device group ${groupKey}, akan diabaikan:`, error.message);
                } else if (error.message?.includes('not connected') || error.message?.includes('connection')) {
                    // Error koneksi, skip group ini
                    console.warn(`[SLA Monitor] Error koneksi untuk device group ${groupKey}, akan diabaikan:`, error.message);
                } else {
                    console.error(`[SLA Monitor] Gagal memproses device group ${groupKey}:`, error.message || error);
                }
                // Jangan throw error untuk mencegah crash seluruh aplikasi
            }
        }
    } catch (error) {
        console.error("[SLA Monitor] Error fatal saat mengambil daftar device:", error);
    }
}

async function logPppoeUsage(workspaceId, client) {
    try {
        // Cek apakah client masih terhubung
        if (!client || !client.connected) {
            throw new Error('Client tidak terhubung');
        }
        
        let allQueues;
        try {
            allQueues = await client.write('/queue/simple/print');
        } catch (err) {
            // Handle !empty reply - ini normal jika tidak ada queue
            if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                return; // Tidak ada queue, skip
            }
            throw err;
        }
        
        if (!allQueues || allQueues.length === 0) return;

        const today = new Date().toISOString().slice(0, 10);

        for (const queue of allQueues) {
            let userName = queue.name;
            if (userName.startsWith('<pppoe-') && userName.endsWith('>')) {
                userName = userName.substring(7, userName.length - 1);
            }

            const [uploadBytesStr, downloadBytesStr] = (queue.bytes || '0/0').split('/');
            const uploadBytes = BigInt(uploadBytesStr);
            const downloadBytes = BigInt(downloadBytesStr);

            if (uploadBytes === 0n && downloadBytes === 0n) continue;

            const totalBytes = uploadBytes + downloadBytes;

            const sql = `
                INSERT INTO pppoe_usage_logs (workspace_id, pppoe_user, usage_date, upload_bytes, download_bytes, total_bytes)
                VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
                upload_bytes = VALUES(upload_bytes), download_bytes = VALUES(download_bytes), total_bytes = VALUES(total_bytes);
            `;
            await pool.query(sql, [
                workspaceId, userName, today,
                uploadBytes.toString(), downloadBytes.toString(), totalBytes.toString(),
                uploadBytes.toString(), downloadBytes.toString(), totalBytes.toString()
            ]);
        }
    } catch (error) {
        // Jangan throw error untuk UNKNOWNREPLY atau error koneksi, hanya log
        if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY') || 
            error.message?.includes('not connected') || error.message?.includes('connection')) {
            console.warn(`[Usage Logger] Error koneksi untuk workspace ${workspaceId}, akan diabaikan:`, error.message || error);
            return; // Jangan throw, biarkan proses lanjut
        }
        console.error(`[Usage Logger] Gagal mencatat pemakaian untuk workspace ${workspaceId}:`, error.message);
        // Jangan throw error untuk mencegah crash, hanya log
    }
}

/**
 * Log data untuk semua workspace
 * OPTIMIZED: Polling sekali per device fisik, share hasil ke semua workspace
 */
async function logAllActiveWorkspaces() {
    try {
        // Group devices berdasarkan credentials
        const deviceGroups = await groupDevicesByCredentials();
        
        // Polling sekali per device fisik
        for (const [groupKey, group] of deviceGroups) {
            if (group.devices.length === 0) continue;
            
            // Gunakan device pertama dari group sebagai representasi
            const firstDevice = group.devices[0];
            
            // Ambil main_interface dari workspace pertama (biasanya sama untuk device yang sama)
            const [workspaceConfig] = await pool.query('SELECT main_interface FROM workspaces WHERE id = ?', [firstDevice.workspace_id]);
            const mainInterface = workspaceConfig[0]?.main_interface || null;
            
            try {
                const CRON_TIMEOUT = 10 * 60 * 1000;
                const client = await getOrCreateConnection(firstDevice.workspace_id, CRON_TIMEOUT, null, firstDevice.device_id);
                
                // Cek apakah client terhubung
                if (!client || !client.connected) {
                    continue; // Skip jika tidak terhubung
                }
                
                // Polling sekali untuk device fisik ini
                await Promise.all([
                    // Log PPPoE usage - share ke semua workspace
                    (async () => {
                        try {
                            for (const device of group.devices) {
                                await logPppoeUsage(device.workspace_id, client);
                            }
                        } catch (e) {
                            console.error(`[Data Logger] Error logging PPPoE usage untuk device group ${groupKey}:`, e.message);
                        }
                    })(),
                    // Log all interfaces traffic - share ke semua workspace
                    (async () => {
                        try {
                            for (const device of group.devices) {
                                await logAllInterfacesTraffic(device.workspace_id, client);
                            }
                        } catch (e) {
                            console.error(`[Data Logger] Error logging traffic untuk device group ${groupKey}:`, e.message);
                        }
                    })()
                ]);

            } catch(e) {
                // Handle error dengan lebih baik, jangan crash aplikasi
                if (e.errno === 'UNKNOWNREPLY' || e.message?.includes('UNKNOWNREPLY')) {
                    console.warn(`[Data Logger] Error UNKNOWNREPLY untuk device group ${groupKey}, akan diabaikan:`, e.message);
                } else {
                    console.error(`[Data Logger] Gagal memproses device group ${groupKey}:`, e.message || e);
                }
                // Jangan throw error untuk mencegah crash seluruh aplikasi
            }
        }
    } catch (error) {
        console.error("[Data Logger] Error fatal saat mengambil daftar device:", error);
    }
}

async function logMainInterfaceTraffic(workspaceId, client, workspaceConfig) {
    if (!workspaceConfig.main_interface) return;

    try {
        // Cek apakah client masih terhubung
        if (!client || !client.connected) {
            throw new Error('Client tidak terhubung');
        }
        
        let interfaceData;
        try {
            const interfaces = await client.write('/interface/print', [`?name=${workspaceConfig.main_interface}`]);
            interfaceData = interfaces[0];
        } catch (err) {
            // Handle !empty reply - interface mungkin tidak ditemukan
            if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                return; // Interface tidak ditemukan, skip
            }
            throw err;
        }
        
        if (!interfaceData) return;

        const workspaceKey = `${workspaceId}-${interfaceData.name}`;
        const lastData = lastTrafficData.get(workspaceKey);

        const currentTx = parseInt(interfaceData['tx-byte'], 10) || 0;
        const currentRx = parseInt(interfaceData['rx-byte'], 10) || 0;

        let txUsage = 0;
        let rxUsage = 0;

        if (lastData) {
            txUsage = (currentTx < lastData.tx) ? currentTx : currentTx - lastData.tx;
            rxUsage = (currentRx < lastData.rx) ? currentRx : currentRx - lastData.rx;
        }

        lastTrafficData.set(workspaceKey, { tx: currentTx, rx: currentRx });

        if (lastData && (txUsage > 0 || rxUsage > 0)) {
            const [activePppoe, activeHotspot] = await Promise.all([
                client.write('/ppp/active/print').then(r => r.length),
                client.write('/ip/hotspot/active/print').then(r => r.length)
            ]);
            const sql = 'INSERT INTO traffic_logs (workspace_id, interface_name, tx_bytes, rx_bytes, tx_usage, rx_usage, active_users_pppoe, active_users_hotspot) VALUES ?';
            const logValues = [[
                workspaceId, interfaceData.name, currentTx, currentRx, txUsage, rxUsage, activePppoe, activeHotspot
            ]];

            await pool.query(sql, [logValues]);
        }
    } catch (error) {
        // Jangan throw error untuk UNKNOWNREPLY atau error koneksi, hanya log
        if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY') || 
            error.message?.includes('not connected') || error.message?.includes('connection')) {
            console.warn(`[Traffic Logger] Error koneksi untuk interface ${workspaceConfig.main_interface}, akan diabaikan:`, error.message || error);
            return; // Jangan throw, biarkan proses lanjut
        }
        console.error(`[Traffic Logger] Gagal memonitor interface ${workspaceConfig.main_interface}:`, error.message);
        // Jangan throw error untuk mencegah crash, hanya log
    }
}

/**
 * Log traffic untuk semua interface yang aktif (running) dan bukan PPPoE
 * Ini memungkinkan report untuk menampilkan data semua interface, bukan hanya main_interface
 */
async function logAllInterfacesTraffic(workspaceId, client) {
    try {
        // Cek apakah client masih terhubung
        if (!client || !client.connected) {
            throw new Error('Client tidak terhubung');
        }
        
        // Ambil semua interface
        let allInterfaces;
        try {
            allInterfaces = await client.write('/interface/print', [], 10000);
            if (!Array.isArray(allInterfaces)) {
                allInterfaces = [];
            }
        } catch (err) {
            if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                return; // Tidak ada interface, skip
            }
            throw err;
        }
        
        // Filter hanya interface yang running dan bukan PPPoE
        const runningInterfaces = allInterfaces.filter(i => {
            const running = i.running === 'true' || i.running === true || i.running === 'yes';
            const type = (i.type || '').toLowerCase();
            // Exclude PPPoE interfaces
            return running && !type.includes('pppoe');
        });
        
        if (runningInterfaces.length === 0) return;
        
        // Ambil active users sekali untuk semua interface
        const [activePppoe, activeHotspot] = await Promise.all([
            client.write('/ppp/active/print').then(r => r.length).catch(() => 0),
            client.write('/ip/hotspot/active/print').then(r => r.length).catch(() => 0)
        ]);
        
        // Log traffic untuk setiap interface
        const logPromises = runningInterfaces.map(async (interfaceData) => {
            try {
                const interfaceName = interfaceData.name;
                const workspaceKey = `${workspaceId}-${interfaceName}`;
                const lastData = lastTrafficData.get(workspaceKey);
                
                const currentTx = parseInt(interfaceData['tx-byte'], 10) || 0;
                const currentRx = parseInt(interfaceData['rx-byte'], 10) || 0;
                
                let txUsage = 0;
                let rxUsage = 0;
                
                if (lastData) {
                    txUsage = (currentTx < lastData.tx) ? currentTx : currentTx - lastData.tx;
                    rxUsage = (currentRx < lastData.rx) ? currentRx : currentRx - lastData.rx;
                }
                
                lastTrafficData.set(workspaceKey, { tx: currentTx, rx: currentRx });
                
                // Log jika ada perubahan usage
                if (lastData && (txUsage > 0 || rxUsage > 0)) {
                    const sql = 'INSERT INTO traffic_logs (workspace_id, interface_name, tx_bytes, rx_bytes, tx_usage, rx_usage, active_users_pppoe, active_users_hotspot) VALUES ?';
                    const logValues = [[
                        workspaceId, interfaceName, currentTx, currentRx, txUsage, rxUsage, activePppoe, activeHotspot
                    ]];
                    
                    await pool.query(sql, [logValues]);
                }
            } catch (err) {
                // Skip error untuk interface tertentu, jangan crash seluruh proses
                console.warn(`[Traffic Logger] Error logging interface ${interfaceData.name}:`, err.message);
            }
        });
        
        await Promise.all(logPromises);
        
    } catch (error) {
        // Jangan throw error untuk UNKNOWNREPLY atau error koneksi, hanya log
        if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY') || 
            error.message?.includes('not connected') || error.message?.includes('connection')) {
            console.warn(`[Traffic Logger] Error koneksi untuk logging interfaces, akan diabaikan:`, error.message || error);
            return; // Jangan throw, biarkan proses lanjut
        }
        console.error(`[Traffic Logger] Gagal memonitor interfaces:`, error.message);
        // Jangan throw error untuk mencegah crash, hanya log
    }
}

/**
 * Update dashboard snapshot untuk instant load
 * Menyimpan data terbaru (resource, traffic, pppoe_active, active_interfaces) ke database
 * Digunakan untuk dashboard bisa langsung tampil data saat pertama kali load
 */
async function updateDashboardSnapshot(workspaceId, deviceId) {
    try {
        // Gunakan timeout lebih lama untuk cron jobs (10 menit)
        // Karena cron job berjalan setiap 3 detik, koneksi akan selalu digunakan
        // Jadi tidak perlu ditutup setelah 30 detik
        const CRON_TIMEOUT = 10 * 60 * 1000; // 10 menit timeout untuk cron jobs
        const client = await getOrCreateConnection(workspaceId, CRON_TIMEOUT, null, deviceId);
        
        // Cek apakah client terhubung
        if (!client || !client.connected) {
            return; // Skip jika tidak terhubung
        }
        
        // Ambil data dari Mikrotik
        let resource = {};
        let pppoeActive = [];
        let interfaces = [];
        let traffic = {};
        
        try {
            // Ambil resource
            const resourceResult = await client.write('/system/resource/print', [], 10000).catch(() => []);
            resource = resourceResult && resourceResult[0] ? resourceResult[0] : {};
        } catch (err) {
            if (!err.message?.includes('!empty') && !err.message?.includes('unknown reply: !empty')) {
                console.warn(`[Dashboard Snapshot] Error mengambil resource untuk workspace ${workspaceId}:`, err.message);
            }
        }
        
        try {
            // Ambil PPPoE active
            pppoeActive = await client.write('/ppp/active/print', [], 10000).catch(() => []);
            if (!Array.isArray(pppoeActive)) {
                pppoeActive = [];
            }
        } catch (err) {
            if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                pppoeActive = [];
            } else {
                console.warn(`[Dashboard Snapshot] Error mengambil PPPoE active untuk workspace ${workspaceId}:`, err.message);
            }
        }
        
        try {
            // Ambil interfaces
            interfaces = await client.write('/interface/print', [], 10000).catch(() => []);
            if (!Array.isArray(interfaces)) {
                interfaces = [];
            }
            
            // Filter hanya interface yang running dan bukan PPPoE
            const runningInterfaces = interfaces.filter(i => 
                i.running === true && 
                !i.type?.toLowerCase().includes('pppoe')
            );
            
            // Ambil traffic untuk interface yang running
            const trafficPromises = runningInterfaces.map(async (iface) => {
                try {
                    const result = await client.write('/interface/monitor-traffic', [`=numbers=${iface.name}`, '=once='], 10000);
                    return result && result[0] ? { name: iface.name, ...result[0] } : null;
                } catch {
                    return null;
                }
            });
            
            const trafficResults = await Promise.all(trafficPromises);
            trafficResults.forEach(result => {
                if (result && result.name) {
                    traffic[result.name] = result;
                }
            });
            
            // Simpan active interfaces (hanya yang running dan bukan PPPoE)
            interfaces = runningInterfaces.map(i => ({
                name: i.name,
                type: i.type || '',
                running: i.running || false
            }));
            
        } catch (err) {
            if (!err.message?.includes('!empty') && !err.message?.includes('unknown reply: !empty')) {
                console.warn(`[Dashboard Snapshot] Error mengambil interfaces untuk workspace ${workspaceId}:`, err.message);
            }
        }
        
        // Simpan ke database (update atau insert)
        await pool.query(`
            INSERT INTO dashboard_snapshot (workspace_id, device_id, resource, traffic, pppoe_active, active_interfaces, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
            resource = VALUES(resource),
            traffic = VALUES(traffic),
            pppoe_active = VALUES(pppoe_active),
            active_interfaces = VALUES(active_interfaces),
            updated_at = NOW()
        `, [
            workspaceId,
            deviceId,
            JSON.stringify(resource),
            JSON.stringify(traffic),
            JSON.stringify(pppoeActive),
            JSON.stringify(interfaces)
        ]);
        
    } catch (error) {
        // Handle error dengan lebih baik, jangan crash aplikasi
        if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY')) {
            if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
                return; // Skip, ini normal
            }
            console.warn(`[Dashboard Snapshot] Error UNKNOWNREPLY untuk workspace ${workspaceId}, akan diabaikan:`, error.message);
        } else if (error.message?.includes('not connected') || error.message?.includes('connection')) {
            console.warn(`[Dashboard Snapshot] Error koneksi untuk workspace ${workspaceId}, akan diabaikan:`, error.message);
        } else {
            console.error(`[Dashboard Snapshot] Gagal memproses workspace ${workspaceId}:`, error.message || error);
        }
    }
}

/**
 * Update snapshot untuk semua device di semua workspace
 * OPTIMIZED: Polling sekali per device fisik, share hasil ke semua workspace
 */
async function updateAllDashboardSnapshots() {
    try {
        // Group devices berdasarkan credentials
        const deviceGroups = await groupDevicesByCredentials();
        
        // Polling sekali per device fisik
        for (const [groupKey, group] of deviceGroups) {
            if (group.devices.length === 0) continue;
            
            // Gunakan device pertama dari group sebagai representasi
            const firstDevice = group.devices[0];
            
            try {
                // Gunakan timeout lebih lama untuk cron jobs (10 menit)
                // Karena cron job berjalan setiap 3 detik, koneksi akan selalu digunakan
                // Jadi tidak perlu ditutup setelah 30 detik
                const CRON_TIMEOUT = 10 * 60 * 1000; // 10 menit timeout untuk cron jobs
                const client = await getOrCreateConnection(firstDevice.workspace_id, CRON_TIMEOUT, null, firstDevice.device_id);
                
                // Cek apakah client terhubung
                if (!client || !client.connected) {
                    continue; // Skip jika tidak terhubung
                }
                
                // Ambil data dari Mikrotik (polling sekali)
                let resource = {};
                let pppoeActive = [];
                let interfaces = [];
                let traffic = {};
                
                try {
                    // Ambil resource
                    const resourceResult = await client.write('/system/resource/print', [], 10000).catch(() => []);
                    resource = resourceResult && resourceResult[0] ? resourceResult[0] : {};
                } catch (err) {
                    if (!err.message?.includes('!empty') && !err.message?.includes('unknown reply: !empty')) {
                        console.warn(`[Dashboard Snapshot] Error mengambil resource untuk device group ${groupKey}:`, err.message);
                    }
                }
                
                try {
                    // Ambil PPPoE active
                    pppoeActive = await client.write('/ppp/active/print', [], 10000).catch(() => []);
                    if (!Array.isArray(pppoeActive)) {
                        pppoeActive = [];
                    }
                } catch (err) {
                    if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                        pppoeActive = [];
                    } else {
                        console.warn(`[Dashboard Snapshot] Error mengambil PPPoE active untuk device group ${groupKey}:`, err.message);
                    }
                }
                
                try {
                    // Ambil interfaces
                    interfaces = await client.write('/interface/print', [], 10000).catch(() => []);
                    if (!Array.isArray(interfaces)) {
                        interfaces = [];
                    }
                    
                    // Filter hanya interface yang running dan bukan PPPoE
                    const runningInterfaces = interfaces.filter(i => 
                        i.running === true && 
                        !i.type?.toLowerCase().includes('pppoe')
                    );
                    
                    // Ambil traffic untuk interface yang running
                    const trafficPromises = runningInterfaces.map(async (iface) => {
                        try {
                            const result = await client.write('/interface/monitor-traffic', [`=numbers=${iface.name}`, '=once='], 10000);
                            return result && result[0] ? { name: iface.name, ...result[0] } : null;
                        } catch {
                            return null;
                        }
                    });
                    
                    const trafficResults = await Promise.all(trafficPromises);
                    traffic = {};
                    trafficResults.forEach(t => {
                        if (t && t.name) {
                            traffic[t.name] = {
                                tx: parseInt(t['tx-bytes'] || 0),
                                rx: parseInt(t['rx-bytes'] || 0)
                            };
                        }
                    });
                } catch (err) {
                    if (!err.message?.includes('!empty') && !err.message?.includes('unknown reply: !empty')) {
                        console.warn(`[Dashboard Snapshot] Error mengambil interfaces untuk device group ${groupKey}:`, err.message);
                    }
                }
                
                // Share hasil ke semua workspace yang menggunakan device ini
                for (const device of group.devices) {
                    try {
                        // Simpan ke database (update atau insert)
                        await pool.query(`
                            INSERT INTO dashboard_snapshot (workspace_id, device_id, resource, traffic, pppoe_active, active_interfaces, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, NOW())
                            ON DUPLICATE KEY UPDATE
                            resource = VALUES(resource),
                            traffic = VALUES(traffic),
                            pppoe_active = VALUES(pppoe_active),
                            active_interfaces = VALUES(active_interfaces),
                            updated_at = NOW()
                        `, [
                            device.workspace_id,
                            device.device_id,
                            JSON.stringify(resource),
                            JSON.stringify(traffic),
                            JSON.stringify(pppoeActive),
                            JSON.stringify(interfaces)
                        ]);
                    } catch (error) {
                        console.error(`[Dashboard Snapshot] Gagal menyimpan snapshot untuk workspace ${device.workspace_id}, device ${device.device_id}:`, error.message);
                    }
                }
                
            } catch (error) {
                // Handle error dengan lebih baik, jangan crash aplikasi
                if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY')) {
                    if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
                        continue; // Skip, ini normal
                    }
                    console.warn(`[Dashboard Snapshot] Error UNKNOWNREPLY untuk device group ${groupKey}, akan diabaikan:`, error.message);
                } else if (error.message?.includes('not connected') || error.message?.includes('connection')) {
                    console.warn(`[Dashboard Snapshot] Error koneksi untuk device group ${groupKey}, akan diabaikan:`, error.message);
                } else {
                    console.error(`[Dashboard Snapshot] Gagal memproses device group ${groupKey}:`, error.message || error);
                }
            }
        }
    } catch (error) {
        console.error("[Dashboard Snapshot] Error fatal saat mengambil daftar device:", error);
    }
}

module.exports = { logAllActiveWorkspaces, processSlaEvents, monitorSlaAndNotifications, updateAllDashboardSnapshots, sendDowntimeNotifications };