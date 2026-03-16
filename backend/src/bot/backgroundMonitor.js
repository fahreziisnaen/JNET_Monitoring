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
const { getOrCreateConnection } = require('../utils/apiConnection');
const mikrotikStore = require('../utils/mikrotikStore');

const POLLING_INTERVAL_MS = 3000;    // polling active users setiap 3 detik
const SECRET_REFRESH_MS = 20000;     // refresh secrets list setiap 20 detik
const INIT_STAGGER_MS = 800;         // jeda antar device saat startup

// Track per-device polling state
const deviceMonitors = new Map(); // deviceKey -> { intervalId, lastSecretFetch, cachedSecrets, isRunning }

/**
 * Mulai monitoring untuk satu device.
 */
async function startDeviceMonitor(workspaceId, deviceId, broadcastCallback) {
    const key = `bg-${workspaceId}-${deviceId}`;
    if (deviceMonitors.has(key)) return; // already running

    console.log(`[BGMonitor] Starting monitor for workspace ${workspaceId}, device ${deviceId}`);

    let client;
    try {
        client = await getOrCreateConnection(workspaceId, 24 * 60 * 60 * 1000, key, deviceId);
    } catch (err) {
        console.warn(`[BGMonitor] Cannot connect device ${deviceId}: ${err.message}`);
        mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'disconnected');
        return;
    }

    const state = {
        isRunning: false,
        lastSecretFetch: 0,
        cachedSecrets: [],
        lastCycleTime: 0,
        lastTrafficLog: 0,
    };
    deviceMonitors.set(key, state);

    // Mark as connected
    mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'connected');
    if (broadcastCallback) {
        broadcastCallback(workspaceId, deviceId, {
            type: 'connection-status',
            payload: { status: 'connected', deviceId, message: 'Terhubung ke perangkat Mikrotik', timestamp: Date.now() }
        });
    }

    const safeWrite = (command, params = [], timeoutMs = 10000) => Promise.race([
        (async () => {
            const result = await client.write(command, params);
            return result;
        })().catch(err => {
            if (err.message?.includes('!empty')) return [];
            throw err;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms: ${command}`)), timeoutMs))
    ]);

    const runCycle = async () => {
        if (state.isRunning) return;
        if (!client?.connected) {
            console.warn(`[BGMonitor] Device ${deviceId} disconnected, stopping monitor`);
            mikrotikStore.setDeviceStatus(workspaceId, deviceId, 'disconnected');
            if (broadcastCallback) {
                broadcastCallback(workspaceId, deviceId, {
                    type: 'connection-status',
                    payload: { status: 'disconnected', deviceId, message: 'Koneksi ke perangkat Mikrotik terputus', timestamp: Date.now() }
                });
            }
            stopDeviceMonitor(workspaceId, deviceId);
            return;
        }

        state.isRunning = true;
        const now = Date.now();

        try {
            // 1. Resource (tiap 3 detik)
            const resource = await safeWrite('/system/resource/print', [], 5000)
                .then(r => r[0] || {})
                .catch(() => ({}));

            // 2. Active users (tiap 3 detik)
            const pppoeActive = await safeWrite('/ppp/active/print', [], 7000).catch(() => []);
            mikrotikStore.setActive(workspaceId, deviceId, pppoeActive);

            // 2b. Hotspot active users (tiap 3 detik, graceful jika tidak ada hotspot)
            const hotspotActive = await safeWrite('/ip/hotspot/active/print', [], 5000).catch(() => []);
            mikrotikStore.setHotspotActive(workspaceId, deviceId, hotspotActive);

            // 2c. Active interfaces (tiap 3 detik)
            const allInterfaces = await safeWrite('/interface/print', [], 7000).catch(() => []);
            const activeInterfaces = allInterfaces
                .filter(iface => iface.running === 'true' || iface.running === true)
                .map(iface => ({ name: iface.name, type: iface.type || 'unknown', running: iface.running }));

            // 2d. Traffic (tiap 3 detik, hanya interface yang running dan bukan PPPoE)
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
                        // Auto-cleanup data lama (> 7 hari)
                        await pool.query(
                            'DELETE FROM interface_traffic_logs WHERE workspace_id = ? AND device_id = ? AND timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)',
                            [workspaceId, deviceId]
                        );
                    } catch (dbErr) {
                        console.error(`[BGMonitor] Failed to log DB traffic history for device ${deviceId}: ${dbErr.message}`);
                    }
                }
            }

            // 3. Secrets (tiap 20 detik)
            if (now - state.lastSecretFetch >= SECRET_REFRESH_MS || state.cachedSecrets.length === 0) {
                const secrets = await safeWrite('/ppp/secret/print', [
                    '.proplist=.id,name,profile,remote-address,disabled'
                ], 45000).catch(err => {
                    console.warn(`[BGMonitor] Device ${deviceId} secrets fetch error: ${err.message}`);
                    return null;
                });

                if (secrets !== null) {
                    state.cachedSecrets = secrets;
                    state.lastSecretFetch = now;
                    mikrotikStore.setSecrets(workspaceId, deviceId, secrets);
                }
            }

            // 4. Merge active info ke secrets → broadcast ke WS clients
            if (broadcastCallback) {
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

                // --- 4.5. Sinkronisasi Real-Time ke Database (MySQL) ---
                if (enriched.length > 0) {
                    const values = enriched.map(s => [
                        workspaceId,
                        deviceId,
                        s.name,
                        s.profile || '',
                        s['remote-address'] || null,
                        s.disabled === 'true' || s.disabled === true ? 1 : 0,
                        s.isActive ? 1 : 0,
                        s.uptime || null,
                        s.currentAddress || null,
                        s.activeConnectionId || null
                    ]);
                    
                    const query = `
                        INSERT INTO pppoe_secrets 
                        (workspace_id, device_id, name, profile, remote_address, disabled, is_active, uptime, current_address, active_connection_id)
                        VALUES ?
                        ON DUPLICATE KEY UPDATE
                        profile = VALUES(profile),
                        remote_address = VALUES(remote_address),
                        disabled = VALUES(disabled),
                        is_active = VALUES(is_active),
                        uptime = VALUES(uptime),
                        current_address = VALUES(current_address),
                        active_connection_id = VALUES(active_connection_id)
                    `;
                    
                    try {
                        await pool.query(query, [values]);
                        // Cleanup secrets yang sudah dihapus di router (yang tidak terupdate lebih dari 1 menit)
                        await pool.query(
                            `DELETE FROM pppoe_secrets WHERE workspace_id = ? AND device_id = ? AND updated_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)`, 
                            [workspaceId, deviceId]
                        );

                        // --- Sync pppoe_user_status agar isActive di peta NOC up-to-date ---
                        const activeUsers = enriched.filter(s => s.isActive);
                        const inactiveUsers = enriched.filter(s => !s.isActive);

                        if (activeUsers.length > 0) {
                            const activeValues = activeUsers.map(s => [workspaceId, deviceId, s.name]);
                            await pool.query(
                                `INSERT INTO pppoe_user_status (workspace_id, device_id, pppoe_user, is_active, last_seen_active)
                                 VALUES ?
                                 ON DUPLICATE KEY UPDATE is_active = TRUE, last_seen_active = NOW()`,
                                [activeValues.map(v => [...v, true, new Date()])]
                            );
                        }
                        if (inactiveUsers.length > 0) {
                            for (const s of inactiveUsers) {
                                await pool.query(
                                    `INSERT INTO pppoe_user_status (workspace_id, device_id, pppoe_user, is_active)
                                     VALUES (?, ?, ?, FALSE)
                                     ON DUPLICATE KEY UPDATE is_active = FALSE`,
                                    [workspaceId, deviceId, s.name]
                                );
                            }
                        }
                    } catch (dbErr) {
                        console.error(`[BGMonitor] DB Sync Error device ${deviceId}: ${dbErr.message}`);
                    }
                }

                broadcastCallback(workspaceId, deviceId, {
                    type: 'batch-update',
                    payload: {
                        resource,
                        pppoeSecrets: enriched,
                        activeInterfaces,
                        traffic,
                        hotspotActive
                    }
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

    // Jalankan langsung setelah 1 detik, lalu setiap 3 detik
    const firstRun = setTimeout(() => runCycle(), 1000);
    const intervalId = setInterval(() => runCycle(), POLLING_INTERVAL_MS);

    state.intervalId = intervalId;
    state.firstRun = firstRun;
}

function stopDeviceMonitor(workspaceId, deviceId) {
    const key = `bg-${workspaceId}-${deviceId}`;
    const state = deviceMonitors.get(key);
    if (state) {
        if (state.intervalId) clearInterval(state.intervalId);
        if (state.firstRun) clearTimeout(state.firstRun);
        deviceMonitors.delete(key);
        console.log(`[BGMonitor] Stopped monitor for workspace ${workspaceId}, device ${deviceId}`);
    }
}

/**
 * Entry point: dipanggil sekali saat server mulai.
 * Fetch semua workspace+device dari DB, lalu start monitor masing-masing.
 * @param {Function} broadcastCallback - function(workspaceId, deviceId, data) untuk push ke WS
 */
async function startBackgroundMonitoring(broadcastCallback = null) {
    console.log('[BGMonitor] Starting background monitoring for all workspaces...');

    try {
        // Ambil semua device dari semua workspace
        const [devices] = await pool.query(`
            SELECT d.id, d.workspace_id, d.name, d.host
            FROM mikrotik_devices d
            ORDER BY d.workspace_id, d.id
        `);

        if (devices.length === 0) {
            console.log('[BGMonitor] No devices found, nothing to monitor.');
            return;
        }

        console.log(`[BGMonitor] Found ${devices.length} device(s) to monitor.`);

        // Stagger startup: 800ms antar device untuk hindari race condition
        devices.forEach((device, index) => {
            setTimeout(() => {
                startDeviceMonitor(device.workspace_id, device.id, broadcastCallback).catch(err => {
                    console.error(`[BGMonitor] Failed to start device ${device.id}: ${err.message}`);
                });
            }, index * INIT_STAGGER_MS);
        });

    } catch (err) {
        console.error('[BGMonitor] Failed to initialize:', err.message);
    }
}

/**
 * Restart monitor untuk satu device (dipanggil saat device ditambah/diubah).
 */
async function restartDeviceMonitor(workspaceId, deviceId, broadcastCallback = null) {
    stopDeviceMonitor(workspaceId, deviceId);
    await new Promise(r => setTimeout(r, 500));
    await startDeviceMonitor(workspaceId, deviceId, broadcastCallback);
}

module.exports = { startBackgroundMonitoring, restartDeviceMonitor, stopDeviceMonitor };
