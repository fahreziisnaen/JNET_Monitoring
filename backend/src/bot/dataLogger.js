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
        
        if (deviceGroups.size === 0) {
            console.log(`[Data Logger] ⚠️ Tidak ada device yang terdaftar untuk logging`);
            return;
        }
        
        console.log(`[Data Logger] 🔄 Memulai logging untuk ${deviceGroups.size} device group(s)`);
        
        // Polling sekali per device fisik
        for (const [groupKey, group] of deviceGroups) {
            if (group.devices.length === 0) continue;
            
            // Gunakan device pertama dari group sebagai representasi
            const firstDevice = group.devices[0];
            
            console.log(`[Data Logger] 📡 Processing device group ${groupKey} (${group.devices.length} workspace(s))`);
            
            // Ambil main_interface dari workspace pertama (biasanya sama untuk device yang sama)
            const [workspaceConfig] = await pool.query('SELECT main_interface FROM workspaces WHERE id = ?', [firstDevice.workspace_id]);
            const mainInterface = workspaceConfig[0]?.main_interface || null;
            
            try {
                const CRON_TIMEOUT = 10 * 60 * 1000;
                const client = await getOrCreateConnection(firstDevice.workspace_id, CRON_TIMEOUT, null, firstDevice.device_id);
                
                // Cek apakah client terhubung
                if (!client || !client.connected) {
                    console.warn(`[Data Logger] ⚠️ Client tidak terhubung untuk device group ${groupKey}, skip`);
                    continue; // Skip jika tidak terhubung
                }
                
                console.log(`[Data Logger] ✅ Client terhubung untuk device group ${groupKey}`);
                
                // Polling sekali untuk device fisik ini
                await Promise.all([
                    // Log PPPoE usage - share ke semua workspace
                    (async () => {
                        try {
                            for (const device of group.devices) {
                                await logPppoeUsage(device.workspace_id, client);
                            }
                        } catch (e) {
                            console.error(`[Data Logger] ❌ Error logging PPPoE usage untuk device group ${groupKey}:`, e.message);
                            console.error(`[Data Logger] Full error:`, e);
                        }
                    })(),
                    // Log all interfaces traffic - share ke semua workspace
                    (async () => {
                        try {
                            for (const device of group.devices) {
                                console.log(`[Data Logger] 📊 Memulai logAllInterfacesTraffic untuk workspace ${device.workspace_id}`);
                                await logAllInterfacesTraffic(device.workspace_id, client);
                            }
                        } catch (e) {
                            console.error(`[Data Logger] ❌ Error logging traffic untuk device group ${groupKey}:`, e.message);
                            console.error(`[Data Logger] Full error:`, e);
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

        // Simpan data sekarang ke memory untuk next iteration (untuk tracking, tidak disimpan ke database)
        lastTrafficData.set(workspaceKey, { tx: currentTx, rx: currentRx });
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
        console.log(`[Traffic Logger] 🚀 Memulai logAllInterfacesTraffic untuk workspace ${workspaceId}`);
        
        // Cek apakah client masih terhubung
        if (!client || !client.connected) {
            console.warn(`[Traffic Logger] ⚠️ Client tidak terhubung untuk workspace ${workspaceId}`);
            throw new Error('Client tidak terhubung');
        }
        
        // Ambil semua interface
        let allInterfaces;
        try {
            console.log(`[Traffic Logger] 📡 Mengambil interface list untuk workspace ${workspaceId}`);
            allInterfaces = await client.write('/interface/print', [], 10000);
            if (!Array.isArray(allInterfaces)) {
                allInterfaces = [];
            }
            console.log(`[Traffic Logger] 📋 Ditemukan ${allInterfaces.length} total interfaces untuk workspace ${workspaceId}`);
        } catch (err) {
            if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                console.warn(`[Traffic Logger] ⚠️ Tidak ada interface untuk workspace ${workspaceId}`);
                return; // Tidak ada interface, skip
            }
            console.error(`[Traffic Logger] ❌ Error mengambil interface untuk workspace ${workspaceId}:`, err.message);
            throw err;
        }
        
        // Filter hanya interface yang running dan bukan PPPoE
        const runningInterfaces = allInterfaces.filter(i => {
            const running = i.running === 'true' || i.running === true || i.running === 'yes';
            const type = (i.type || '').toLowerCase();
            // Exclude PPPoE interfaces
            return running && !type.includes('pppoe');
        });
        
        if (runningInterfaces.length === 0) {
            console.log(`[Traffic Logger] Tidak ada interface yang running untuk workspace ${workspaceId}`);
            return;
        }
        
        console.log(`[Traffic Logger] Found ${runningInterfaces.length} running interfaces untuk workspace ${workspaceId}:`, runningInterfaces.map(i => i.name).join(', '));
        
        // Ambil active users sekali untuk semua interface
        // Gunakan sequential dengan timeout lebih panjang untuk menghindari hang/race condition
        console.log(`[Traffic Logger] 📊 Mengambil active users untuk workspace ${workspaceId}...`);
        let activePppoe = 0;
        let activeHotspot = 0;
        
        try {
            // Ambil secara sequential untuk menghindari race condition
            // Gunakan timeout 10 detik karena bisa ada banyak data
            console.log(`[Traffic Logger] 📡 Mengambil PPPoE active (timeout 10s)...`);
            try {
                const pppoeResult = await client.write('/ppp/active/print', [], 10000);
                activePppoe = Array.isArray(pppoeResult) ? pppoeResult.length : 0;
                console.log(`[Traffic Logger] ✅ Active PPPoE users: ${activePppoe}`);
            } catch (pppoeErr) {
                // Jika timeout atau error, set ke 0 dan lanjutkan
                if (pppoeErr.message?.includes('timeout') || pppoeErr.message?.includes('Timeout')) {
                    console.warn(`[Traffic Logger] ⚠️ Timeout mengambil PPPoE active, menggunakan 0`);
                } else {
                    console.warn(`[Traffic Logger] ⚠️ Error mengambil PPPoE active:`, pppoeErr.message);
                }
                activePppoe = 0;
            }
            
            console.log(`[Traffic Logger] 📡 Mengambil Hotspot active (timeout 10s)...`);
            try {
                const hotspotResult = await client.write('/ip/hotspot/active/print', [], 10000);
                activeHotspot = Array.isArray(hotspotResult) ? hotspotResult.length : 0;
                console.log(`[Traffic Logger] ✅ Active Hotspot users: ${activeHotspot}`);
            } catch (hotspotErr) {
                // Jika timeout atau error, set ke 0 dan lanjutkan
                if (hotspotErr.message?.includes('timeout') || hotspotErr.message?.includes('Timeout')) {
                    console.warn(`[Traffic Logger] ⚠️ Timeout mengambil Hotspot active, menggunakan 0`);
                } else {
                    console.warn(`[Traffic Logger] ⚠️ Error mengambil Hotspot active:`, hotspotErr.message);
                }
                activeHotspot = 0;
            }
            
            console.log(`[Traffic Logger] ✅ Selesai mengambil active users`);
        } catch (err) {
            console.error(`[Traffic Logger] ❌ Error fatal saat mengambil active users:`, err.message);
            console.error(`[Traffic Logger] Full error:`, err);
            // Set default values jika error
            activePppoe = 0;
            activeHotspot = 0;
        }
        
        console.log(`[Traffic Logger] 📊 Total active users: PPPoE=${activePppoe}, Hotspot=${activeHotspot}`);
        console.log(`[Traffic Logger] 🔄 Memulai proses logging untuk ${runningInterfaces.length} interfaces...`);
        
        // Log traffic untuk setiap interface
        const logPromises = runningInterfaces.map(async (interfaceData) => {
            try {
                const interfaceName = interfaceData.name;
                const workspaceKey = `${workspaceId}-${interfaceName}`;
                const lastData = lastTrafficData.get(workspaceKey);
                
                // Gunakan /interface/print untuk mendapatkan data kumulatif (total bytes sejak boot)
                // Ini diperlukan untuk menghitung usage (selisih dengan data sebelumnya)
                // Field dari /interface/print bisa berbeda tergantung versi RouterOS
                let currentTx = 0;
                let currentRx = 0;
                
                // Cari field yang mengandung 'tx' dan 'rx' (case insensitive)
                const allKeys = Object.keys(interfaceData);
                const txKey = allKeys.find(k => k.toLowerCase().includes('tx') && (k.toLowerCase().includes('byte') || k.toLowerCase().includes('bytes')));
                const rxKey = allKeys.find(k => k.toLowerCase().includes('rx') && (k.toLowerCase().includes('byte') || k.toLowerCase().includes('bytes')));
                
                if (txKey) {
                    currentTx = parseInt(interfaceData[txKey], 10) || 0;
                }
                if (rxKey) {
                    currentRx = parseInt(interfaceData[rxKey], 10) || 0;
                }
                
                // Debug: log field yang ditemukan
                if (txKey || rxKey) {
                    console.log(`[Traffic Logger] 🔍 Interface ${interfaceName}: txKey=${txKey || 'NOT FOUND'}, rxKey=${rxKey || 'NOT FOUND'}, tx=${currentTx}, rx=${currentRx}`);
                } else {
                    // Log jika field tidak ditemukan
                    const txRxFields = allKeys.filter(k => k.toLowerCase().includes('tx') || k.toLowerCase().includes('rx'));
                    console.warn(`[Traffic Logger] ⚠️ Interface ${interfaceName} tidak memiliki tx/rx byte fields.`);
                    console.warn(`[Traffic Logger] 🔍 Available tx/rx fields:`, txRxFields.join(', '));
                    console.warn(`[Traffic Logger] 🔍 Sample data (first 10 fields):`, allKeys.slice(0, 10).join(', '));
                    // Skip interface ini jika tidak ada data
                    return;
                }
                
                let txUsage = 0;
                let rxUsage = 0;
                
                if (lastData) {
                    txUsage = (currentTx < lastData.tx) ? currentTx : currentTx - lastData.tx;
                    rxUsage = (currentRx < lastData.rx) ? currentRx : currentRx - lastData.rx;
                }
                
                // Simpan data sekarang ke memory untuk next iteration (untuk tracking, tidak disimpan ke database)
                lastTrafficData.set(workspaceKey, { tx: currentTx, rx: currentRx });
            } catch (err) {
                // Skip error untuk interface tertentu, jangan crash seluruh proses
                console.warn(`[Traffic Logger] Error logging interface ${interfaceData.name}:`, err.message);
                console.error(`[Traffic Logger] Full error untuk interface ${interfaceData.name}:`, err);
            }
        });
        
        console.log(`[Traffic Logger] ⏳ Menunggu semua log promises selesai (${logPromises.length} promises)...`);
        try {
            await Promise.all(logPromises);
            console.log(`[Traffic Logger] ✅ Semua log promises selesai untuk workspace ${workspaceId}`);
        } catch (promiseError) {
            console.error(`[Traffic Logger] ❌ Error dalam Promise.all(logPromises):`, promiseError.message);
            console.error(`[Traffic Logger] Full Promise.all error:`, promiseError);
        }
        
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
        console.log(`[Dashboard Snapshot] 🚀 Memulai updateDashboardSnapshot untuk workspace ${workspaceId}, device ${deviceId}`);
        
        // Gunakan timeout lebih lama untuk cron jobs (10 menit)
        // Karena cron job berjalan setiap 3 detik, koneksi akan selalu digunakan
        // Jadi tidak perlu ditutup setelah 30 detik
        const CRON_TIMEOUT = 10 * 60 * 1000; // 10 menit timeout untuk cron jobs
        const client = await getOrCreateConnection(workspaceId, CRON_TIMEOUT, null, deviceId);
        
        // Cek apakah client terhubung
        if (!client || !client.connected) {
            console.warn(`[Dashboard Snapshot] ⚠️ Client tidak terhubung untuk workspace ${workspaceId}, device ${deviceId}`);
            return; // Skip jika tidak terhubung
        }
        
        console.log(`[Dashboard Snapshot] ✅ Client terhubung untuk workspace ${workspaceId}, device ${deviceId}`);
        
        // Ambil data dari Mikrotik
        let resource = {};
        let pppoeActive = [];
        let interfaces = [];
        let traffic = {};
        
        try {
            // Ambil resource
            const resourceResult = await client.write('/system/resource/print', [], 10000).catch(() => []);
            resource = resourceResult && resourceResult[0] ? resourceResult[0] : {};
            
            // Simpan resource log ke database untuk historical tracking
            if (resource && Object.keys(resource).length > 0) {
                const cpuLoad = parseInt(resource['cpu-load'], 10) || null;
                const memoryUsage = resource['free-memory'] ? parseInt(resource['free-memory'], 10) : null;
                // Total memory = free-memory + used-memory (jika ada)
                const totalMemory = resource['total-memory'] ? parseInt(resource['total-memory'], 10) : null;
                const usedMemory = totalMemory && memoryUsage ? totalMemory - memoryUsage : null;
                
                try {
                    await pool.query(
                        'INSERT INTO resource_logs (workspace_id, device_id, cpu_load, memory_usage) VALUES (?, ?, ?, ?)',
                        [workspaceId, deviceId, cpuLoad, usedMemory]
                    );
                } catch (logError) {
                    // Jangan crash jika logging gagal, hanya warn
                    console.warn(`[Resource Logger] Gagal menyimpan log untuk workspace ${workspaceId}, device ${deviceId}:`, logError.message);
                }
            }
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

// Flag untuk mencegah multiple execution bersamaan
let isUpdatingSnapshots = false;

/**
 * Update snapshot untuk semua device di semua workspace
 * OPTIMIZED: Polling sekali per device fisik, share hasil ke semua workspace
 */
async function updateAllDashboardSnapshots() {
    // Prevent multiple execution bersamaan
    if (isUpdatingSnapshots) {
        console.log(`[Dashboard Snapshot] ⏭️ Update sudah berjalan, skip execution ini`);
        return;
    }
    
    isUpdatingSnapshots = true;
    
    try {
        console.log(`[Dashboard Snapshot] 🔄 Memulai updateAllDashboardSnapshots`);
        
        // Group devices berdasarkan credentials
        const deviceGroups = await groupDevicesByCredentials();
        
        if (deviceGroups.size === 0) {
            console.log(`[Dashboard Snapshot] ⚠️ Tidak ada device yang terdaftar untuk snapshot`);
            return;
        }
        
        console.log(`[Dashboard Snapshot] 📡 Processing ${deviceGroups.size} device group(s)`);
        
        // Polling sekali per device fisik
        for (const [groupKey, group] of deviceGroups) {
            if (group.devices.length === 0) continue;
            
            // Gunakan device pertama dari group sebagai representasi
            const firstDevice = group.devices[0];
            
            console.log(`[Dashboard Snapshot] 📡 Processing device group ${groupKey} (${group.devices.length} workspace(s))`);
            
            try {
                // Gunakan timeout lebih lama untuk cron jobs (10 menit)
                // Karena cron job berjalan setiap 3 detik, koneksi akan selalu digunakan
                // Jadi tidak perlu ditutup setelah 30 detik
                const CRON_TIMEOUT = 10 * 60 * 1000; // 10 menit timeout untuk cron jobs
                const client = await getOrCreateConnection(firstDevice.workspace_id, CRON_TIMEOUT, null, firstDevice.device_id);
                
                // Cek apakah client terhubung
                if (!client || !client.connected) {
                    console.warn(`[Dashboard Snapshot] ⚠️ Client tidak terhubung untuk device group ${groupKey}, skip`);
                    continue; // Skip jika tidak terhubung
                }
                
                console.log(`[Dashboard Snapshot] ✅ Client terhubung untuk device group ${groupKey}`);
                
                // Ambil data dari Mikrotik (polling sekali)
                let resource = {};
                let pppoeActive = [];
                let interfaces = [];
                let traffic = {};
                
                try {
                    // Ambil resource
                    console.log(`[Dashboard Snapshot] 📡 Mengambil resource untuk device group ${groupKey}...`);
                    const resourceResult = await client.write('/system/resource/print', [], 10000).catch((err) => {
                        console.warn(`[Dashboard Snapshot] ⚠️ Error mengambil resource (catch):`, err.message);
                        return [];
                    });
                    resource = resourceResult && resourceResult[0] ? resourceResult[0] : {};
                    console.log(`[Dashboard Snapshot] ✅ Resource berhasil diambil untuk device group ${groupKey}, keys:`, Object.keys(resource).length);
                    
                    // Simpan resource log ke database untuk semua device di group ini
                    if (resource && Object.keys(resource).length > 0) {
                        const cpuLoad = parseInt(resource['cpu-load'], 10) || null;
                        const memoryUsage = resource['free-memory'] ? parseInt(resource['free-memory'], 10) : null;
                        const totalMemory = resource['total-memory'] ? parseInt(resource['total-memory'], 10) : null;
                        const usedMemory = totalMemory && memoryUsage ? totalMemory - memoryUsage : null;
                        
                        console.log(`[Resource Logger] 💾 Menyimpan resource logs untuk ${group.devices.length} device(s)...`);
                        // Log untuk setiap device di group (karena mereka share device fisik yang sama)
                        for (const device of group.devices) {
                            try {
                                await pool.query(
                                    'INSERT INTO resource_logs (workspace_id, device_id, cpu_load, memory_usage) VALUES (?, ?, ?, ?)',
                                    [device.workspace_id, device.device_id, cpuLoad, usedMemory]
                                );
                                console.log(`[Resource Logger] ✅ Resource log tersimpan untuk workspace ${device.workspace_id}, device ${device.device_id}`);
                            } catch (logError) {
                                console.error(`[Resource Logger] ❌ Gagal menyimpan log untuk workspace ${device.workspace_id}, device ${device.device_id}:`, logError.message);
                            }
                        }
                        console.log(`[Resource Logger] ✅ Selesai menyimpan resource logs`);
                    }
                } catch (err) {
                    if (!err.message?.includes('!empty') && !err.message?.includes('unknown reply: !empty')) {
                        console.error(`[Dashboard Snapshot] ❌ Error mengambil resource untuk device group ${groupKey}:`, err.message);
                        console.error(`[Dashboard Snapshot] Full error:`, err);
                    } else {
                        console.log(`[Dashboard Snapshot] ℹ️ Resource empty (normal)`);
                    }
                }
                
                try {
                    // Ambil PPPoE active
                    console.log(`[Dashboard Snapshot] 📡 Mengambil PPPoE active untuk device group ${groupKey}...`);
                    pppoeActive = await client.write('/ppp/active/print', [], 10000).catch((err) => {
                        console.warn(`[Dashboard Snapshot] ⚠️ Error mengambil PPPoE active (catch):`, err.message);
                        return [];
                    });
                    if (!Array.isArray(pppoeActive)) {
                        pppoeActive = [];
                    }
                    console.log(`[Dashboard Snapshot] ✅ PPPoE active berhasil diambil untuk device group ${groupKey}, count: ${pppoeActive.length}`);
                } catch (err) {
                    if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                        console.log(`[Dashboard Snapshot] ℹ️ PPPoE active empty (normal)`);
                        pppoeActive = [];
                    } else {
                        console.error(`[Dashboard Snapshot] ❌ Error mengambil PPPoE active untuk device group ${groupKey}:`, err.message);
                        console.error(`[Dashboard Snapshot] Full error:`, err);
                    }
                }
                
                try {
                    // Ambil interfaces
                    console.log(`[Dashboard Snapshot] 📡 Mengambil interface list untuk device group ${groupKey}`);
                    interfaces = await client.write('/interface/print', [], 10000).catch(() => []);
                    if (!Array.isArray(interfaces)) {
                        interfaces = [];
                    }
                    console.log(`[Dashboard Snapshot] 📋 Ditemukan ${interfaces.length} total interfaces untuk device group ${groupKey}`);
                    
                    // Filter hanya interface yang running dan bukan PPPoE
                    // Gunakan logika yang sama dengan logAllInterfacesTraffic
                    const runningInterfaces = interfaces.filter(i => {
                        const running = i.running === 'true' || i.running === true || i.running === 'yes';
                        const type = (i.type || '').toLowerCase();
                        // Exclude PPPoE interfaces
                        return running && !type.includes('pppoe');
                    });
                    
                    console.log(`[Dashboard Snapshot] ✅ Found ${runningInterfaces.length} running interfaces untuk device group ${groupKey}:`, runningInterfaces.map(i => i.name).join(', '));
                    
                    // Ambil traffic untuk interface yang running
                    // Gunakan data dari /interface/print untuk dashboard snapshot
                    console.log(`[Dashboard Snapshot] 📊 Mengambil traffic data untuk ${runningInterfaces.length} interfaces dari /interface/print...`);
                    let validResults = [];
                    
                    // Gunakan data dari interfaces yang sudah diambil sebelumnya (dari /interface/print)
                    // Ini lebih reliable daripada /interface/monitor-traffic yang sering timeout
                    for (let index = 0; index < runningInterfaces.length; index++) {
                        const iface = runningInterfaces[index];
                        try {
                            // Cari interface data dari interfaces array yang sudah diambil
                            const interfaceData = interfaces.find(i => i.name === iface.name);
                            
                            if (interfaceData) {
                                // Cari field yang benar dari /interface/print
                                const allKeys = Object.keys(interfaceData);
                                const txKey = allKeys.find(k => k.toLowerCase().includes('tx') && (k.toLowerCase().includes('byte') || k.toLowerCase().includes('bytes')));
                                const rxKey = allKeys.find(k => k.toLowerCase().includes('rx') && (k.toLowerCase().includes('byte') || k.toLowerCase().includes('bytes')));
                                
                                const txBytes = txKey ? parseInt(interfaceData[txKey], 10) || 0 : 0;
                                const rxBytes = rxKey ? parseInt(interfaceData[rxKey], 10) || 0 : 0;
                                
                                if (txKey && rxKey) {
                                    validResults.push({
                                        name: iface.name,
                                        'tx-bytes': txBytes,
                                        'rx-bytes': rxBytes
                                    });
                                    console.log(`[Dashboard Snapshot] ✅ [${index + 1}/${runningInterfaces.length}] Traffic data dari /interface/print untuk interface ${iface.name}: tx=${txBytes}, rx=${rxBytes}`);
                                } else {
                                    console.warn(`[Dashboard Snapshot] ⚠️ [${index + 1}/${runningInterfaces.length}] Interface ${iface.name} tidak memiliki tx/rx fields`);
                                }
                            } else {
                                console.warn(`[Dashboard Snapshot] ⚠️ [${index + 1}/${runningInterfaces.length}] Interface ${iface.name} tidak ditemukan di interfaces array`);
                        }
                        } catch (err) {
                            console.error(`[Dashboard Snapshot] ❌ [${index + 1}/${runningInterfaces.length}] Error memproses interface ${iface.name}:`, err.message);
                            // Continue dengan interface berikutnya, jangan stop
                        }
                    }
                    
                    console.log(`[Dashboard Snapshot] ✅ Mendapat ${validResults.length}/${runningInterfaces.length} traffic results dari /interface/print`);
                    
                    traffic = {};
                    
                    // Build traffic object dari validResults
                    validResults.forEach(t => {
                        if (t && t.name) {
                            // Cari field yang benar dari monitor-traffic
                            const allKeys = Object.keys(t);
                            const rxKey = allKeys.find(k => k.toLowerCase().includes('rx') && (k.toLowerCase().includes('byte') || k.toLowerCase().includes('bytes')));
                            const txKey = allKeys.find(k => k.toLowerCase().includes('tx') && (k.toLowerCase().includes('byte') || k.toLowerCase().includes('bytes')));
                            
                            const rxBytes = rxKey ? parseInt(t[rxKey], 10) || 0 : 0;
                            const txBytes = txKey ? parseInt(t[txKey], 10) || 0 : 0;
                            
                            traffic[t.name] = {
                                tx: txBytes,
                                rx: rxBytes
                            };
                        }
                    });
                } catch (err) {
                    if (!err.message?.includes('!empty') && !err.message?.includes('unknown reply: !empty')) {
                        console.error(`[Dashboard Snapshot] ❌ Error mengambil interfaces untuk device group ${groupKey}:`, err.message);
                        console.error(`[Dashboard Snapshot] Full error:`, err);
                    } else {
                        console.log(`[Dashboard Snapshot] ℹ️ Interfaces empty (normal)`);
                    }
                }
                
                // Share hasil ke semua workspace yang menggunakan device ini
                console.log(`[Dashboard Snapshot] 💾 Menyimpan snapshot untuk ${group.devices.length} workspace(s) di device group ${groupKey}...`);
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
                        console.log(`[Dashboard Snapshot] ✅ Snapshot tersimpan untuk workspace ${device.workspace_id}, device ${device.device_id}`);
                    } catch (error) {
                        console.error(`[Dashboard Snapshot] ❌ Gagal menyimpan snapshot untuk workspace ${device.workspace_id}, device ${device.device_id}:`, error.message);
                        console.error(`[Dashboard Snapshot] Full error:`, error);
                    }
                }
                console.log(`[Dashboard Snapshot] ✅ Selesai memproses device group ${groupKey}`);
                
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
    } finally {
        // Reset flag setelah selesai
        isUpdatingSnapshots = false;
        console.log(`[Dashboard Snapshot] ✅ updateAllDashboardSnapshots selesai, flag direset`);
    }
}

module.exports = { logAllActiveWorkspaces, processSlaEvents, monitorSlaAndNotifications, updateAllDashboardSnapshots, sendDowntimeNotifications };