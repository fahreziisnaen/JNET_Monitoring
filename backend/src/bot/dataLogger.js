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
/**
 * Format tanggal dan waktu ke format: 15/3/2026, 16.08.31
 * @param {Date} date - Date object
 * @returns {string}
 */
function formatDateTime(date = new Date()) {
    const d = date.getDate();
    const m = date.getMonth() + 1;
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${d}/${m}/${y}, ${h}.${min}.${s}`;
}

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
    const stateKey = `${workspaceId}_${device.id}`;
    if (!alarmState.has(stateKey)) {
        alarmState.set(stateKey, { cpuCooldown: 0, offlineCooldown: 0, isOffline: false });
    }
    const state = alarmState.get(stateKey);
    const now = Date.now();

    // Ambil WhatsApp target (group atau individual) dari workspace
    const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
    if (!whatsappTarget) return;

    // Suppress alerts during initial startup (5 minutes)
    if (now - serverStartTime < SUPPRESSION_PERIOD_MS) {
        return;
    }

    try {
        // AMBIL DATA DARI STORE (Zero-API approach)
        // BackgroundMonitor sudah mengupdate store ini secara berkala
        const resource = mikrotikStore.getResource(workspaceId, device.id) || {};
        const deviceStatus = mikrotikStore.getDeviceStatus(workspaceId, device.id);

        if (deviceStatus === 'connected') {
            if (state.isOffline) {
                // Transmit 'connected' broadcast to UI to dismiss failure Toast instantly
                if (broadcastCallback) {
                    console.error(`[Notifikasi] Perangkat ${device.name} KEMBALI ONLINE`);
                    broadcastCallback(workspaceId, device.id, {
                        type: 'connection-status',
                        payload: {
                            status: 'connected',
                            deviceId: device.id,
                            deviceName: device.name,
                            message: `Koneksi ke perangkat ${device.name} berhasil dipulihkan.`,
                            timestamp: Date.now()
                        }
                    });
                }

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
        } else if (deviceStatus === 'disconnected' || !deviceStatus) {
            // Track that we are currently offline so recovery knows to fire
            if (!state.isOffline) {
                state.isOffline = true;
                // Immediate notification on first failure
                if (state.offlineCooldown < now) {
                    console.error(`[Notifikasi] Perangkat ${device.name} TERDETEKSI OFFLINE`);
                    const message = `❌ *PERANGKAT OFFLINE* ❌\n\nKoneksi ke perangkat *${device.name}* terputus. Mohon periksa jaringan Anda.`;
                    await sendWhatsAppMessage(whatsappTarget, message);
                    state.offlineCooldown = now + OFFLINE_COOLDOWN_MINUTES * 60 * 1000;
                }
            }
        }
    } catch (error) {
        console.error(`[Alarm Check] Error memproses ${device.name}:`, error.message);
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
            SELECT d.id, d.workspace_id, m.name as device_name, d.start_time, d.pppoe_user, w.name as workspace_name
            FROM downtime_events d
            JOIN mikrotik_devices m ON d.device_id = m.id
            JOIN workspaces w ON d.workspace_id = w.id
            WHERE d.end_time IS NULL 
              AND d.notification_sent = FALSE
              AND d.start_time < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        `;
        const [downtimes] = await pool.query(query);

        if (downtimes.length === 0) return;

        // Group by workspace_id
        const groups = {};
        for (const d of downtimes) {
            if (!groups[d.workspace_id]) groups[d.workspace_id] = { name: d.workspace_name, items: [] };
            groups[d.workspace_id].items.push(d);
        }

        for (const workspaceId in groups) {
            const group = groups[workspaceId];
            const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
            if (!whatsappTarget) continue;

            const nowStr = formatDateTime();
            let message = `🚨 *PPPoE User Disconnected* 🚨\n\n`;
            message += `Waktu: ${nowStr}\n\n`;

            if (group.items.length === 1) {
                const item = group.items[0];
                const startTime = formatDateTime(new Date(item.start_time));
                message += `User yang offline:\n`;
                message += `• *${item.pppoe_user}* (*${item.device_name}*) sejak ${startTime}\n\n`;
            } else {
                message += `User yang offline (${group.items.length}):\n`;
                group.items.forEach((item, index) => {
                    const startTime = formatDateTime(new Date(item.start_time));
                    message += `${index + 1}. *${item.pppoe_user}* (*${item.device_name}*) - ${startTime}\n`;
                });
                message += `\n`;
            }
            message += `Silakan periksa kondisi jaringan atau hubungi user terkait..`;

            const success = await sendWhatsAppMessage(whatsappTarget, message);
            if (success) {
                const ids = group.items.map(i => i.id);
                await pool.query('UPDATE downtime_events SET notification_sent = TRUE WHERE id IN (?)', [ids]);
                console.log(`[Notifikasi] Berhasil mengirim alert DISCONNECT untuk ${group.items.length} user di workspace ${group.name}`);
            }
        }
    } catch (error) {
        console.error('[Bot Service] Error in sendDowntimeNotifications:', error);
    }
}

async function sendReconnectNotifications(broadcastCallback = null) {
    try {
        // Suppress client alerts during initial startup (5 minutes)
        if (Date.now() - serverStartTime < SUPPRESSION_PERIOD_MS) {
            return;
        }

        const query = `
            SELECT d.id, d.workspace_id, m.name as device_name, d.start_time, d.end_time, d.pppoe_user, d.duration_seconds, w.name as workspace_name
            FROM downtime_events d
            JOIN mikrotik_devices m ON d.device_id = m.id
            JOIN workspaces w ON d.workspace_id = w.id
            WHERE d.end_time IS NOT NULL 
              AND d.end_time < DATE_SUB(NOW(), INTERVAL 1 MINUTE)
              AND (d.reconnect_notification_sent = FALSE OR d.reconnect_notification_sent IS NULL)
              AND d.notification_sent = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM downtime_events d2 
                WHERE d2.workspace_id = d.workspace_id 
                  AND d2.device_id = d.device_id 
                  AND d2.pppoe_user = d.pppoe_user 
                  AND d2.start_time > d.end_time
              )
        `;
        const [reconnects] = await pool.query(query);

        console.log(`[Reconnect Alert] Ditemukan ${reconnects.length} event reconnect yang perlu dikirim.`);
        if (reconnects.length === 0) return;

        // Group by workspace_id
        const groups = {};
        for (const r of reconnects) {
            if (!groups[r.workspace_id]) groups[r.workspace_id] = { name: r.workspace_name, items: [] };
            groups[r.workspace_id].items.push(r);
        }

        for (const workspaceId in groups) {
            const group = groups[workspaceId];
            const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
            if (!whatsappTarget) continue;

            const nowStr = formatDateTime();
            let message = `✅ *PPPoE User Reconnected* ✅\n\n`;
            message += `Waktu: ${nowStr}\n\n`;

            if (group.items.length === 1) {
                const item = group.items[0];
                message += `User yang reconnect:\n`;
                message += `1. *${item.pppoe_user}* (*${item.device_name}*) - ${formatDuration(item.duration_seconds)}\n\n`;
            } else {
                message += `User yang reconnect (${group.items.length}):\n`;
                group.items.forEach((item, index) => {
                    message += `${index + 1}. *${item.pppoe_user}* (*${item.device_name}*) - ${formatDuration(item.duration_seconds)}\n`;
                });
                message += `\n`;
            }
            message += `Koneksi telah pulih. User dapat menggunakan layanan kembali.`;

            const success = await sendWhatsAppMessage(whatsappTarget, message);
            if (success) {
                const ids = group.items.map(i => i.id);
                await pool.query('UPDATE downtime_events SET reconnect_notification_sent = TRUE WHERE id IN (?)', [ids]);
                console.log(`[Notifikasi] Berhasil mengirim alert RECONNECT untuk ${group.items.length} user di workspace ${group.name}`);
            }
        }
    } catch (error) {
        console.error('[Bot Service] Error in sendReconnectNotifications:', error);
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

module.exports = { monitorSlaAndNotifications, sendDowntimeNotifications, sendReconnectNotifications };
