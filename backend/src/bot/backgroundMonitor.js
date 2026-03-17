/**
 * backgroundMonitor.js
 * 
 * Always-on background service yang polling SEMUA device dari SEMUA workspace
 * secara independen dari WebSocket connections.
 * 
 * Update mikrotikStore setiap 3 detik per device, sehingga:
 * - REST API (/api/pppoe/secrets) selalu punya data terbaru
 * - WS connections yang ada mendapat broadcast secara real-time
 * - Tidak perlu menunggu browser/user konek dulu untuk mulai polling
 */

const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');
const mikrotikStore = require('../utils/mikrotikStore');

const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS) || 3000;    // polling active users setiap 3 detik
const SECRET_REFRESH_MS = parseInt(process.env.SECRET_REFRESH_MS) || 120000;    // refresh secrets list setiap 2 menit (sebelumnya 20 detik)
const INIT_STAGGER_MS = 800;         // jeda antar device saat startup

// Track per-device polling state
const deviceMonitors = new Map(); // deviceKey -> { intervalId, lastSecretFetch, cachedSecrets, isRunning }

/**
 * Mulai monitoring untuk satu device.
 */
async function startDeviceMonitor(workspaceId, deviceId, broadcastCallback) {
    const monitorKey = `bg-${workspaceId}-${deviceId}`;
    if (deviceMonitors.has(monitorKey)) return; 
    console.log(`[BGMonitor] Starting monitor for workspace ${workspaceId}, device ${deviceId}`);

    const state = {
        isRunning: false,
        isFetchingSecrets: false,
        lastSecretFetch: 0,
        cachedSecrets: [],
        lastCycleTime: 0,
        lastTrafficLog: 0,
    };
    deviceMonitors.set(monitorKey, state);

    // Initial status
    mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'connected');

    const runCycle = async () => {
        if (state.isRunning) return;
        state.isRunning = true;
        const now = Date.now();
        const cycleId = Math.random().toString(36).substring(7);

        try {
            // 1. Resource
            const resource = await runCommandForWorkspace(workspaceId, '/system/resource/print', [], deviceId)
                .then(r => r[0] || {})
                .catch(() => ({}));
            
            // 2. Active users
            const pppoeActive = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [], deviceId).catch(err => {
                console.warn(`[BGMonitor] Error fetching active users on device ${deviceId}: ${err.message}`);
                return null;
            });

            if (pppoeActive !== null) {
                mikrotikStore.setActive(workspaceId, deviceId, pppoeActive);
                mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'connected');
            } else {
                mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'disconnected');
            }

            // 2b. Hotspot active users
            const hotspotActive = await runCommandForWorkspace(workspaceId, '/ip/hotspot/active/print', [], deviceId).catch(() => []);
            if (hotspotActive && hotspotActive.length > 0) {
                mikrotikStore.setHotspotActive(workspaceId, deviceId, hotspotActive);
            }

            /*
            // 2c. Active interfaces (tiap 3 detik)
            const allInterfaces = await safeWrite('/interface/print', [], 7000).catch(() => []);
            const activeInterfaces = allInterfaces
                .filter(iface => iface.running === 'true' || iface.running === true)
                .map(iface => ({ name: iface.name, type: iface.type || 'unknown', running: iface.running }));

            // 2d. Traffic (tiap 3 detik)
            const interfacesToMonitor = allInterfaces
                .filter(iface => {
                    const type = (iface.type || '').toLowerCase();
                    const running = iface.running === 'true' || iface.running === true;
                    return running && !type.includes('pppoe') && !['loopback', 'pptp-in', 'l2tp-in'].includes(type);
                })
                .map(iface => iface.name);

            const trafficResults = await Promise.all(
                interfacesToMonitor.map(name =>
                    safeWrite('/interface/monitor-traffic', [`=interface=${name}`, '=once='], 3000)
                        .then(r => r[0]).catch(() => null)
                )
            );
            const traffic = {};
            trafficResults.forEach(result => {
                if (result && result.name) traffic[result.name] = result;
            });

            // 2e. Simpan History Traffic ke Database (Tiap 1 menit)
            if (now - state.lastTrafficLog >= 60000 && Object.keys(traffic).length > 0) {
                state.lastTrafficLog = now;
                const trafficValues = [];
                for (const [ifaceName, tf] of Object.entries(traffic)) {
                    trafficValues.push([workspaceId, deviceId, ifaceName, tf['tx-bits-per-second'] || 0, tf['rx-bits-per-second'] || 0]);
                }
                if (trafficValues.length > 0) {
                    try {
                        await pool.query(
                            'INSERT INTO interface_traffic_logs (workspace_id, device_id, interface_name, tx_bps, rx_bps) VALUES ?',
                            [trafficValues]
                        );
                        await pool.query(
                            'DELETE FROM interface_traffic_logs WHERE workspace_id = ? AND device_id = ? AND timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)',
                            [workspaceId, deviceId]
                        );
                    } catch (dbErr) {
                        console.error(`[BGMonitor] Failed to log DB traffic history: ${dbErr.message}`);
                    }
                }
            }
            */
           const activeInterfaces = [];
           const traffic = {};

            // 3. Secrets (tiap 2 menit, ASYNC non-blocking)
            if (!state.isFetchingSecrets && (now - state.lastSecretFetch >= SECRET_REFRESH_MS || state.cachedSecrets.length === 0)) {
                state.isFetchingSecrets = true;
                (async () => {
                    try {
                        // console.log(`[BGMonitor] Device ${deviceId} secrets sync START`);
                        const secrets = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [], deviceId);
                        if (secrets !== null && Array.isArray(secrets)) {
                            state.cachedSecrets = secrets;
                            state.lastSecretFetch = Date.now();
                            mikrotikStore.setSecrets(workspaceId, deviceId, secrets);
                            // console.log(`[BGMonitor] Device ${deviceId} secrets sync SUCCESS: ${secrets.length} records`);
                        }
                    } catch (err) {
                        console.warn(`[BGMonitor] Secrets sync failure for device ${deviceId}: ${err.message}`);
                    } finally {
                        state.isFetchingSecrets = false;
                    }
                })();
            }

            // 4. Merge active info ke secrets & Sync ke Database
            const activeMap = new Map();
            pppoeActive.forEach(u => {
                if (u.name) activeMap.set(u.name, { address: u.address, uptime: u.uptime, '.id': u['.id'] });
            });

            const enriched = state.cachedSecrets.map(secret => {
                const activeInfo = activeMap.get(secret.name);
                const enrichedSecret = Object.assign({}, secret);
                enrichedSecret.isActive = !!activeInfo;
                if (activeInfo?.uptime) enrichedSecret.uptime = activeInfo.uptime;
                if (activeInfo?.['.id']) enrichedSecret.activeConnectionId = activeInfo['.id'];
                if (activeInfo?.address) {
                    enrichedSecret.currentAddress = activeInfo.address;
                    if (!enrichedSecret['remote-address']) enrichedSecret['remote-address'] = activeInfo.address;
                }
                return enrichedSecret;
            });

            // 4. Merge active info ke secrets & Sync ke Database
            // HANYA jika pppoeActive sukses diambil (tidak null). Jika null (timeout), 
            // kita SKIP sinkronisasi siklus ini agar tidak mereset data isActive di DB ke 0.
            if (pppoeActive !== null && enriched.length > 0) {
                // Debug log
                const activeCount = enriched.filter(s => s.isActive).length;
                // console.log(`[BGMonitor Debug] Device ${deviceId} enriched: ${enriched.length}, active: ${activeCount}`);
                
                try {
                    // Sync pppoe_secrets (untuk Client Creation & Detail)
                    const secretsValues = enriched.map(s => [
                        workspaceId, deviceId, s.name, s.profile || '', s['remote-address'] || null,
                        s.disabled === 'true' || s.disabled === true ? 1 : 0,
                        s.isActive ? 1 : 0, s.uptime || null, s.currentAddress || null, s.activeConnectionId || null
                    ]);

                    const statusQuery = `
                        INSERT INTO pppoe_secrets 
                        (workspace_id, device_id, name, profile, remote_address, disabled, is_active, uptime, current_address, active_connection_id)
                        VALUES ?
                        ON DUPLICATE KEY UPDATE
                        profile = VALUES(profile), remote_address = VALUES(remote_address), disabled = VALUES(disabled),
                        is_active = VALUES(is_active), uptime = VALUES(uptime), current_address = VALUES(current_address),
                        active_connection_id = VALUES(active_connection_id), updated_at = NOW()
                    `;

                    const [secretsResult] = await pool.query(statusQuery, [secretsValues]);
                    // console.error(`[BGMonitor Debug] Device ${deviceId} Sync Result: affectedRows=${secretsResult.affectedRows}, changedRows=${secretsResult.changedRows}, totalRows=${secretsValues.length}`);

                    // Cleanup data lama (60 menit)
                    await pool.query(
                        `DELETE FROM pppoe_secrets WHERE workspace_id = ? AND device_id = ? AND updated_at < DATE_SUB(NOW(), INTERVAL 60 MINUTE)`,
                        [workspaceId, deviceId]
                    );

                    // Sync pppoe_user_status (untuk NOC Map)
                    const activeUsers = enriched.filter(s => s.isActive);
                    if (activeUsers.length > 0) {
                        const activeStatusValues = activeUsers.map(u => [workspaceId, deviceId, u.name, true, new Date()]);
                        await pool.query(`
                            INSERT INTO pppoe_user_status (workspace_id, device_id, pppoe_user, is_active, last_seen_active)
                            VALUES ?
                            ON DUPLICATE KEY UPDATE is_active = TRUE, last_seen_active = NOW()
                        `, [activeStatusValues]);
                    }

                    // Set inactive users (graceful, avoid bulk deactivate errors)
                    const inactiveNames = enriched.filter(s => !s.isActive).map(s => s.name);
                    if (inactiveNames.length > 0) {
                        // Bulk update is faster and safer
                        await pool.query(`
                            UPDATE pppoe_user_status 
                            SET is_active = FALSE 
                            WHERE workspace_id = ? AND device_id = ? AND pppoe_user IN (?)
                        `, [workspaceId, deviceId, inactiveNames]);
                    }

                } catch (dbErr) {
                    console.error(`[BGMonitor] DB Sync Error device ${deviceId}: ${dbErr.message}`);
                }
            }

            // 5. Broadcast ke WS
            if (broadcastCallback) {
                broadcastCallback(workspaceId, deviceId, {
                    type: 'batch-update',
                    payload: { resource, pppoeSecrets: enriched, activeInterfaces, traffic, hotspotActive }
                });

                broadcastCallback(workspaceId, deviceId, {
                    type: 'pppoe-secrets',
                    payload: { secrets: enriched, deviceId, timestamp: Date.now() }
                });
            }

        } catch (err) {
            console.error(`[BGMonitor] Device ${deviceId} cycle error: ${err.message}`);
            if (err.message?.includes('not connected') || err.message?.includes('connection closed')) {
                mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'disconnected');
                stopDeviceMonitor(workspaceId, deviceId);
            }
        } finally {
            state.isRunning = false;
        }
    };

    const firstRun = setTimeout(() => runCycle(), 1000);
    const intervalId = setInterval(() => runCycle(), POLLING_INTERVAL_MS);
    state.intervalId = intervalId;
    state.firstRun = firstRun;
}

function stopDeviceMonitor(workspaceId, deviceId) {
    const monitorKey = `bg-${workspaceId}-${deviceId}`;
    const state = deviceMonitors.get(monitorKey);
    if (state) {
        if (state.intervalId) clearInterval(state.intervalId);
        if (state.firstRun) clearTimeout(state.firstRun);
        deviceMonitors.delete(monitorKey);
        console.log(`[BGMonitor] Stopped monitor for workspace ${workspaceId}, device ${deviceId}`);
    }
}

async function startBackgroundMonitoring(broadcastCallback = null) {
    console.log('[BGMonitor] Starting background monitoring...');
    try {
        const [devices] = await pool.query(`SELECT id, workspace_id FROM mikrotik_devices`);
        devices.forEach((device, index) => {
            setTimeout(() => {
                startDeviceMonitor(device.workspace_id, device.id, broadcastCallback).catch(console.error);
            }, index * INIT_STAGGER_MS);
        });
    } catch (err) {
        console.error('[BGMonitor] Init failed:', err.message);
    }
}

async function restartDeviceMonitor(workspaceId, deviceId, broadcastCallback = null) {
    stopDeviceMonitor(workspaceId, deviceId);
    await new Promise(r => setTimeout(r, 500));
    startDeviceMonitor(workspaceId, deviceId, broadcastCallback).catch(console.error);
}

module.exports = { startBackgroundMonitoring, restartDeviceMonitor, stopDeviceMonitor };
