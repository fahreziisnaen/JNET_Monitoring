const pool = require('../config/database');
const { runCommandForWorkspace, getDeviceConnectionKey } = require('../utils/apiConnection');
const { sendWhatsAppMessage, getWorkspaceWhatsAppTarget } = require('../services/whatsappService');
const crypto = require('crypto');
const mikrotikStore = require('../utils/mikrotikStore');

// Global start time to suppress alerts on restart
const serverStartTime = Date.now();
const SUPPRESSION_PERIOD_MS = 5 * 60 * 1000; // 5 menit

/**
 * Wrapper client.write() dengan timeout agar tidak hang selamanya.
 * node-routeros tidak memiliki built-in external timeout pada Promise-nya.
 * @param {object} client - RouterOSAPI client instance
 * @param {string} command - RouterOS command
 * @param {Array} params - Command parameters
 * @param {number} timeoutMs - Timeout in milliseconds (default 15s)
 */
// safeWrite removed in favor of runCommandForWorkspace

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

// Configuration constants from environment variables
const CPU_COOLDOWN_MINUTES = parseInt(process.env.CPU_COOLDOWN_MINUTES) || 15;
const OFFLINE_COOLDOWN_MINUTES = parseInt(process.env.OFFLINE_COOLDOWN_MINUTES) || 15;
const TRAFFIC_LOG_INTERVAL_MS = parseInt(process.env.TRAFFIC_LOG_INTERVAL_MS) || 60000;
const DASHBOARD_UPDATE_INTERVAL_MS = parseInt(process.env.DASHBOARD_UPDATE_INTERVAL_MS) || 15000;

async function checkAlarms(workspaceId, device, broadcastCallback = null) {
    if (!alarmState.has(workspaceId)) {
        alarmState.set(workspaceId, { cpuCooldown: 0, offlineCooldown: 0, isOffline: false });
    }
    const state = alarmState.get(workspaceId);
    const now = Date.now();

    // Ambil WhatsApp target (group atau individual) dari workspace
    const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
    // Suppress alerts during initial startup (5 minutes)
    if (now - serverStartTime < SUPPRESSION_PERIOD_MS) {
        // Hanya update status store, jangan kirim alarm WA
        try {
            const [resource] = await runCommandForWorkspace(workspaceId, '/system/resource/print', [], device.id);
            if (state.isOffline) {
                state.isOffline = false;
                mikrotikStore.setDeviceStatus(workspaceId, device.id, 'connected');
            }
        } catch (e) {
            state.isOffline = true;
            mikrotikStore.setDeviceStatus(workspaceId, device.id, 'disconnected');
        }
        return;
    }

    try {
        const [resource] = await runCommandForWorkspace(workspaceId, '/system/resource/print', [], device.id);
        if (state.isOffline) {
            // Transmit 'connected' broadcast to UI to dismiss failure Toast instantly
            if (broadcastCallback) {
                console.log(`[Notifikasi] Mengabarkan status PERANGKAT ONLINE ke workspace ${workspaceId}`);
                broadcastCallback(workspaceId, device.id, {
                    type: 'connection-status',
                    payload: {
                        status: 'connected',
                        deviceId: device.id,
                        message: `Koneksi ke perangkat Mikrotik berhasil dipulihkan.`,
                        timestamp: Date.now()
                    }
                });
            }
            mikrotikStore.setDeviceStatus(workspaceId, device.id, 'connected');

            if (state.offlineCooldown !== 0) {
                const message = `✅ *PERANGKAT ONLINE* ✅\n\nKoneksi ke perangkat *${device.name}* telah pulih.`;
                await sendWhatsAppMessage(whatsappTarget, message);
                state.offlineCooldown = 0;
            }

            // Reset offline flag
            state.isOffline = false;
        }

        const [alarms] = await pool.query('SELECT * FROM alarms WHERE workspace_id = ? AND type = "CPU_LOAD"', [workspaceId]);
        if (alarms.length > 0 && state.cpuCooldown < now) {
            const cpuLoad = parseInt(resource['cpu-load'], 10) || 0;
            if (cpuLoad > alarms[0].threshold_mbps) {
                const message = `🚨 *ALARM CPU TINGGI* 🚨\n\nPerangkat *${device.name}* mengalami lonjakan CPU mencapai *${cpuLoad}%*. Segera periksa kondisi perangkat Anda!`;
                await sendWhatsAppMessage(whatsappTarget, message);
                state.cpuCooldown = now + CPU_COOLDOWN_MINUTES * 60 * 1000;
            }
        }
    } catch (error) {
        // Track that we are currently offline so recovery knows to fire
        if (!state.isOffline) {
            state.isOffline = true;
            // Immediate notification on first failure
            if (state.offlineCooldown < now) {
                const message = `❌ *PERANGKAT OFFLINE* ❌\n\nKoneksi ke perangkat *${device.name}* terputus. Mohon periksa jaringan Anda.`;
                await sendWhatsAppMessage(whatsappTarget, message);
                state.offlineCooldown = now + OFFLINE_COOLDOWN_MINUTES * 60 * 1000;
            }
        }
    }
}

async function monitorSlaAndNotifications(broadcastCallback = null) {
    try {
        // Group devices by physical credentials to avoid redundant polling
        const groups = await groupDevicesByCredentials();
        
        for (const [groupKey, group] of groups) {
            if (group.devices.length === 0) continue;
            
            // Perwakilan untuk polling physical
            const rep = group.devices[0];
            
            // Lakukan alarm check untuk setiap instance dalam group
            for (const inst of group.devices) {
                // inst di sini adalah { workspace_id, id, host, name }
                await checkAlarms(inst.workspace_id, inst, broadcastCallback);
            }
        }
    } catch (error) {
        console.error('[Bot Service] Error in monitorSlaAndNotifications:', error);
    }
}

async function sendDowntimeNotifications(broadcastCallback = null) {
    try {
        // Suppress client alerts during initial startup (5 minutes)
        if (Date.now() - serverStartTime < SUPPRESSION_PERIOD_MS) {
            return;
        }

        const query = `
            SELECT d.id, d.workspace_id, m.name, d.start_time, d.pppoe_user
            FROM downtime_events d
            JOIN mikrotik_devices m ON d.device_id = m.id
            WHERE d.end_time IS NULL 
              AND d.notification_sent = FALSE
              AND d.start_time < DATE_SUB(NOW(), INTERVAL 2 MINUTE)
        `;
        const [downtimes] = await pool.query(query);

        for (const downtime of downtimes) {
            const whatsappTarget = await getWorkspaceWhatsAppTarget(downtime.workspace_id);
            if (!whatsappTarget) continue;

            const message = `⚠️ *KLIEN DOWN* ⚠️\n\nKlien *${downtime.pppoe_user}* pada perangkat *${downtime.name}* terdeteksi offline sejak ${new Date(downtime.start_time).toLocaleString('id-ID')}.`;
            
            const success = await sendWhatsAppMessage(whatsappTarget, message);
            if (success) {
                await pool.query('UPDATE downtime_events SET notification_sent = TRUE WHERE id = ?', [downtime.id]);
                console.log(`[Notifikasi] Berhasil mengirim alert KLIEN DOWN untuk ${downtime.pppoe_user}`);
            }
        }
    } catch (error) {
        console.error('[Bot Service] Error in sendDowntimeNotifications:', error);
    }
}

async function groupDevicesByCredentials() {
    const [devices] = await pool.query('SELECT * FROM mikrotik_devices');
    const groups = new Map();

    for (const device of devices) {
        // Unique key based on connection details
        const key = crypto.createHash('md5').update(`${device.host}:${device.port}:${device.user}:${device.password}`).digest('hex');
        if (!groups.has(key)) {
            groups.set(key, {
                credentials: { host: device.host, port: device.port, user: device.user, password: device.password },
                devices: []
            });
        }
        groups.get(key).devices.push({ workspace_id: device.workspace_id, id: device.id, host: device.host, name: device.name });
    }
    return groups;
}

// Optimization: Single snapshot per unique physical device
async function updateDashboardSnapshot(workspaceId, deviceId) {
    try {
        const [devices] = await pool.query('SELECT * FROM mikrotik_devices WHERE id = ?', [deviceId]);
        if (devices.length === 0) return;

        const device = devices[0];
        const resource = await runCommandForWorkspace(workspaceId, '/system/resource/print', [], deviceId, true).then(r => r[0]).catch(() => ({}));
        const activeUsersCount = await runCommandForWorkspace(workspaceId, '/ppp/active/print', ['=count-only='], deviceId, true).catch(() => 0);
        
        await pool.query(
            'UPDATE mikrotik_devices SET last_known_cpu = ?, last_known_uptime = ?, last_known_active_users = ?, last_status_update = NOW() WHERE id = ?',
            [resource['cpu-load'] || 0, resource['uptime'] || 'unknown', activeUsersCount, deviceId]
        );
    } catch (error) {
        // Handle error dengan lebih baik, jangan crash aplikasi
        if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY')) {
            if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
                return; // Skip, ini normal
            }
            console.warn(`[Status Dashboard] Error UNKNOWNREPLY untuk workspace ${workspaceId}, akan diabaikan:`, error.message);
        } else if (error.message?.includes('not connected') || error.message?.includes('connection')) {
            console.warn(`[Status Dashboard] Error koneksi untuk workspace ${workspaceId}, akan diabaikan:`, error.message);
        } else {
            console.error(`[Status Dashboard] Gagal memproses workspace ${workspaceId}:`, error.message || error);
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
        if (process.env.DEBUG_API === 'true') {
            console.log(`[Status Dashboard] ⏭️ Pembaruan sudah berjalan, melewati siklus ini`);
        }
        return;
    }

    isUpdatingSnapshots = true;

    try {
        if (process.env.DEBUG_API === 'true') {
            console.log(`[Status Dashboard] 🔄 Memulai sinkronisasi snapshot dashboard`);
        }

        // Group devices berdasarkan credentials
        const deviceGroups = await groupDevicesByCredentials();

        if (deviceGroups.size === 0) {
            console.log(`[Status Dashboard] ⚠️ Tidak ada perangkat yang terdaftar untuk snapshot`);
            return;
        }

        console.log(`[Status Dashboard] 📡 Memproses ${deviceGroups.size} grup perangkat`);

        // Polling sekali per device fisik
        for (const [groupKey, group] of deviceGroups) {
            if (group.devices.length === 0) continue;

            // Gunakan device pertama dari group sebagai representasi
            const firstDevice = group.devices[0];
            // Label mudah dibaca untuk log (menggantikan MD5 hash groupKey)
            const groupLabel = `${firstDevice.name} (${firstDevice.host})`;

            try {
                if (process.env.DEBUG_API === 'true') {
                    console.log(`[Status Dashboard] 📡 Memproses kelompok ${groupLabel}...`);
                }
                // Trigger update snapshot untuk setiap device di group ini
                // updateDashboardSnapshot sudah menggunakan runCommandForWorkspace yang robust
                for (const device of group.devices) {
                    await updateDashboardSnapshot(device.workspace_id, device.id);
                }

            } catch (error) {
                console.error(`[Status Dashboard] ❌ Gagal memproses grup ${groupLabel}:`, error.message);
            }
        }
    } catch (error) {
        console.error("[Status Dashboard] ❌ Kesalahan fatal saat mengambil daftar perangkat:", error);
    } finally {
        // Reset flag setelah selesai
        isUpdatingSnapshots = false;
        if (process.env.DEBUG_API === 'true') {
            console.log(`[Status Dashboard] ✅ Pembaruan snapshot selesai, flag direset`);
        }
    }
}

module.exports = { monitorSlaAndNotifications, sendDowntimeNotifications };