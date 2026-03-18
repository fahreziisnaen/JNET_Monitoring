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
const crypto = require('crypto');

const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS) || 3000;    // polling active users setiap 3 detik
const SECRET_REFRESH_MS = parseInt(process.env.SECRET_REFRESH_MS) || 120000;    // refresh secrets list setiap 2 menit (sebelumnya 20 detik)
const INIT_STAGGER_MS = 800;         // jeda antar device saat startup

// Track physical device polling state
// Key: md5(host:port:user:pass)
const physicalMonitors = new Map(); // physicalKey -> { intervalId, state }
const logicalToPhysical = new Map(); // workspaceId:deviceId -> physicalKey

/**
 * Mulai monitoring untuk satu perangkat FISIK (Physical Device).
 * Satu router fisik mungkin digunakan oleh banyak workspace.
 */
async function startPhysicalMonitor(group, broadcastCallback) {
    const physicalKey = group.key;
    if (physicalMonitors.has(physicalKey)) return;

    const firstDevice = group.devices[0];
    const label = `Router: ${firstDevice.host} (Used by ${group.devices.length} instances)`;

    const state = {
        isRunning: false,
        isFetchingSecrets: false,
        lastSecretFetch: 0,
        cachedSecrets: [],
        lastCycleTime: 0,
        lastTrafficLog: 0,
        group: group, // Menyimpan list {workspace_id, id}
        broadcastCallback: broadcastCallback,
    };

    console.error(`[Pemantauan] Monitor FISIK AKTIF: ${label}`);

    const runCycle = async () => {
        if (state.isRunning) return;
        state.isRunning = true;
        const now = Date.now();

        try {
            // Gunakan device_id pertama sebagai perwakilan untuk runCommand
            const rep = group.devices[0];
            const workspaceId = rep.workspace_id;
            const deviceId = rep.id;

            // 1. Resource
            const resource = await runCommandForWorkspace(workspaceId, '/system/resource/print', [], deviceId)
                .then(r => r[0] || {})
                .catch(() => ({}));
            
            // 2. Active users
            const pppoeActive = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [], deviceId).catch(err => {
                console.error(`[Pemantauan] Gagal mengambil daftar user aktif di ${label}: ${err.message}`);
                return null;
            });

            // Update status untuk SEMUA instance yang menggunakan router ini
            for (const inst of group.devices) {
                if (pppoeActive !== null) {
                    mikrotikStore.setActive(inst.workspace_id, inst.id, pppoeActive);
                    mikrotikStore.setDeviceStatus(inst.workspace_id, inst.id, 'connected');
                    mikrotikStore.setResource(inst.workspace_id, inst.id, resource);

                    // Update database untuk Dashboard Snapshot
                    pool.query(
                        'UPDATE mikrotik_devices SET last_known_cpu = ?, last_known_uptime = ?, last_known_active_users = ?, last_status_update = NOW() WHERE id = ?',
                        [resource['cpu-load'] || 0, resource['uptime'] || 'unknown', pppoeActive.length, inst.id]
                    ).catch(() => {});
                } else {
                    mikrotikStore.setDeviceStatus(inst.workspace_id, inst.id, 'disconnected');
                    pool.query('UPDATE mikrotik_devices SET last_status_update = NOW() WHERE id = ?', [inst.id]).catch(() => {});
                }
            }

            // 2b. Hotspot active users (DISABLED - Not needed as per user request)
            /*
            if (state.hasHotspot !== false) {
                // Gunakan device Connection Key default (shared) agar tidak buka socket baru
                runCommandForWorkspace(workspaceId, '/ip/hotspot/active/print', [], deviceId)
                    .then(hotspotActive => {
                        state.hasHotspot = true;
                        if (hotspotActive && hotspotActive.length > 0) {
                            for (const inst of group.devices) {
                                mikrotikStore.setHotspotActive(inst.workspace_id, inst.id, hotspotActive);
                            }
                        }
                    })
                    .catch(err => {
                        const errMsg = (err.message || "").toLowerCase();
                        if (errMsg.includes('no such command') || errMsg.includes('unknown command')) {
                            state.hasHotspot = false; 
                        }
                    });
            }
            */

            // 2c. Interfaces & Traffic
            const allInterfaces = await runCommandForWorkspace(workspaceId, '/interface/print', [], deviceId).catch(() => []);
            const activeInterfaces = allInterfaces
                .filter(iface => iface.running === 'true' || iface.running === true || iface.running === 'yes')
                .map(iface => ({ name: iface.name, type: iface.type || 'unknown', running: iface.running }));

            const interfacesToMonitor = allInterfaces
                .filter(iface => {
                    const type = (iface.type || '').toLowerCase();
                    const running = iface.running === 'true' || iface.running === true || iface.running === 'yes';
                    return running && !type.includes('pppoe') && !['loopback', 'pptp-in', 'l2tp-in'].includes(type);
                })
                .map(iface => iface.name);

            const trafficResults = await Promise.all(
                interfacesToMonitor.map(name =>
                    runCommandForWorkspace(workspaceId, '/interface/monitor-traffic', [`=interface=${name}`, '=once='], deviceId)
                        .then(r => r[0]).catch(() => null)
                )
            );
            const traffic = {};
            trafficResults.forEach(result => {
                if (result && result.name) traffic[result.name] = result;
            });

            // Simpan Traffic History ke DB per Workspace/Device
            if (now - state.lastTrafficLog >= 60000 && Object.keys(traffic).length > 0) {
                state.lastTrafficLog = now;
                for (const inst of group.devices) {
                    const trafficValues = Object.entries(traffic).map(([ifaceName, tf]) => [
                        inst.workspace_id, inst.id, ifaceName, tf['tx-bits-per-second'] || 0, tf['rx-bits-per-second'] || 0
                    ]);
                    if (trafficValues.length > 0) {
                        pool.query('INSERT INTO interface_traffic_logs (workspace_id, device_id, interface_name, tx_bps, rx_bps) VALUES ?', [trafficValues])
                            .catch(err => console.error(`[Pencatatan] Gagal simpan trafik DB: ${err.message}`));
                    }
                }
            }

            // 3. Secrets (tiap 2 menit)
            if (!state.isFetchingSecrets && (now - state.lastSecretFetch >= SECRET_REFRESH_MS || state.cachedSecrets.length === 0)) {
                state.isFetchingSecrets = true;
                (async () => {
                    try {
                        // Gunakan key per physical agar tidak tabrakan antar router FISIK
                        const secrets = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [], deviceId, {
                            customKey: `heavy-${physicalKey}`,
                            timeout: 120000
                        });
                        
                        if (secrets !== null && Array.isArray(secrets)) {
                            state.cachedSecrets = secrets;
                            state.lastSecretFetch = Date.now();
                            for (const inst of group.devices) {
                                mikrotikStore.setSecrets(inst.workspace_id, inst.id, secrets);
                            }
                        }
                    } catch (err) {
                        console.error(`[Singkronisasi] Gagal fetch secrets ${label}: ${err.message}`);
                    } finally {
                        state.isFetchingSecrets = false;
                    }
                })();
            }

            // 4. Proses Enrichment & SLA Sync per Workspace
            const activeMap = new Map();
            if (pppoeActive !== null) {
                pppoeActive.forEach(u => {
                    if (u.name) activeMap.set(u.name, { address: u.address, uptime: u.uptime, '.id': u['.id'] });
                });
            }

            // Selalu broadcast data yang tersedia (Resource & Traffic)
            // Meskipun Secrets belum selesai difetch di awal startup
            for (const inst of group.devices) {
                try {
                    const currentSecrets = mikrotikStore.getSecrets(inst.workspace_id, inst.id) || [];
                    const enriched = currentSecrets.map(secret => {
                        const activeInfo = activeMap.get(secret.name);
                        const enrichedSecret = { ...secret, isActive: !!activeInfo };
                        if (activeInfo?.uptime) enrichedSecret.uptime = activeInfo.uptime;
                        if (activeInfo?.['.id']) enrichedSecret.activeConnectionId = activeInfo['.id'];
                        if (activeInfo?.address) {
                            enrichedSecret.currentAddress = activeInfo.address;
                            if (!enrichedSecret['remote-address']) enrichedSecret['remote-address'] = activeInfo.address;
                        }
                        return enrichedSecret;
                    });

                    const activeUsers = enriched.filter(s => s.isActive);
                    const inactiveNames = enriched.filter(s => !s.isActive).map(s => s.name);

                    // Sync Database pppoe_secrets (Hanya jika ada data pppoeActive yang valid)
                    if (pppoeActive !== null && enriched.length > 0) {
                        const secretsValues = enriched.map(s => [
                            inst.workspace_id, inst.id, s.name, s.profile || '', s['remote-address'] || null,
                            s.disabled === 'true' || s.disabled === true ? 1 : 0,
                            s.isActive ? 1 : 0, s.uptime || null, s.currentAddress || null, s.activeConnectionId || null
                        ]);
                        await pool.query(`
                            INSERT INTO pppoe_secrets (workspace_id, device_id, name, profile, remote_address, disabled, is_active, uptime, current_address, active_connection_id)
                            VALUES ? ON DUPLICATE KEY UPDATE profile=VALUES(profile), remote_address=VALUES(remote_address), disabled=VALUES(disabled), 
                            is_active=VALUES(is_active), uptime=VALUES(uptime), current_address=VALUES(current_address), active_connection_id=VALUES(active_connection_id), updated_at=NOW()
                        `, [secretsValues]).catch(e => console.error(`[DB] Galgal sync secrets: ${e.message}`));

                        // Sync pppoe_user_status (NOC)
                        if (activeUsers.length > 0) {
                            const activeStatusValues = activeUsers.map(u => [inst.workspace_id, inst.id, u.name, true, new Date()]);
                            await pool.query(`INSERT INTO pppoe_user_status (workspace_id, device_id, pppoe_user, is_active, last_seen_active) VALUES ? ON DUPLICATE KEY UPDATE is_active=TRUE, last_seen_active=NOW()`, [activeStatusValues]).catch(() => {});
                        }
                        if (inactiveNames.length > 0) {
                            await pool.query(`UPDATE pppoe_user_status SET is_active=FALSE WHERE workspace_id=? AND device_id=? AND pppoe_user IN (?)`, [inst.workspace_id, inst.id, inactiveNames]).catch(() => {});
                        }

                        // --- SLA TRACKING ---
                        if (activeUsers.length > 0) {
                            await pool.query(`UPDATE downtime_events SET end_time=NOW(), duration_seconds=TIMESTAMPDIFF(SECOND, start_time, NOW()) WHERE workspace_id=? AND device_id=? AND pppoe_user IN (?) AND end_time IS NULL`, [inst.workspace_id, inst.id, activeUsers.map(u=>u.name)]).catch(() => {});
                        }
                        const eligibleForDowntime = enriched.filter(s => !s.isActive && (s.disabled === 0 || s.disabled === false || s.disabled === 'false'));
                        for (const user of eligibleForDowntime) {
                            const [open] = await pool.query('SELECT id FROM downtime_events WHERE workspace_id=? AND device_id=? AND pppoe_user=? AND end_time IS NULL', [inst.workspace_id, inst.id, user.name]).catch(()=>[[]]);
                            if (open.length === 0) await pool.query('INSERT INTO downtime_events (workspace_id, device_id, pppoe_user, start_time) VALUES (?, ?, ?, NOW())', [inst.workspace_id, inst.id, user.name]).catch(() => {});
                        }
                    }

                    // Broadcast ke Workspace (Dashboard UI)
                    if (state.broadcastCallback) {
                        state.broadcastCallback(inst.workspace_id, inst.id, {
                            type: 'batch-update',
                            payload: { 
                                resource, 
                                pppoeSecrets: enriched, 
                                activeInterfaces, 
                                traffic
                            }
                        });
                    }
                } catch (instErr) {
                    console.error(`[Pencatatan] Gagal sync workspace ${inst.workspace_id}: ${instErr.message}`);
                }
            }

        } catch (err) {
            console.error(`[Pemantauan] Gangguan siklus ${label}: ${err.message}`);
        } finally {
            state.isRunning = false;
        }
    };

    const intervalId = setInterval(() => runCycle(), POLLING_INTERVAL_MS);
    state.intervalId = intervalId;
    physicalMonitors.set(physicalKey, state);
    
    // Initial run
    setTimeout(() => runCycle(), 500);
}

async function startBackgroundMonitoring(broadcastCallback = null) {
    console.error('[Sistem] Memulai layanan pemantauan latar belakang (Optimized)...');
    try {
        const [devices] = await pool.query(`SELECT * FROM mikrotik_devices`);
        console.error(`[Sistem] Menemukan ${devices.length} perangkat di database`);
        
        const groups = new Map();

        devices.forEach(device => {
            const credentials = `${device.host}:${device.port}:${device.user}:${device.password||''}`;
            const key = crypto.createHash('md5').update(credentials).digest('hex');
            
            if (!groups.has(key)) {
                groups.set(key, { key, devices: [] });
            }
            groups.get(key).devices.push(device);
            logicalToPhysical.set(`${device.workspace_id}:${device.id}`, key);
        });

        console.error(`[Sistem] Berhasil membuat ${groups.size} grup pemantauan fisik`);

        let index = 0;
        for (const group of groups.values()) {
            setTimeout(() => {
                startPhysicalMonitor(group, broadcastCallback).catch(err => {
                    console.error(`[Sistem] Gagal memulai monitor fisik ${group.key}:`, err.message);
                });
            }, index * INIT_STAGGER_MS);
            index++;
        }
    } catch (err) {
        console.error('[BGMonitor] Init failed:', err.message);
    }
}

function stopDeviceMonitor(workspaceId, deviceId) {
    const logicalKey = `${workspaceId}:${deviceId}`;
    const physicalKey = logicalToPhysical.get(logicalKey);
    if (!physicalKey) return;

    const state = physicalMonitors.get(physicalKey);
    if (state) {
        // Hapus instance ini dari group
        state.group.devices = state.group.devices.filter(d => d.id !== deviceId || d.workspace_id !== workspaceId);
        
        // Jika tidak ada instance lagi yang menggunakan router ini, matikan monitor physical-nya
        if (state.group.devices.length === 0) {
            if (state.intervalId) clearInterval(state.intervalId);
            physicalMonitors.delete(physicalKey);
            console.log(`[Pemantauan] Menghentikan pemantauan FISIK untuk router ${physicalKey}`);
        }
    }
    logicalToPhysical.delete(logicalKey);
}

async function restartDeviceMonitor(workspaceId, deviceId, broadcastCallback = null) {
    stopDeviceMonitor(workspaceId, deviceId);
    await new Promise(r => setTimeout(r, 1000));
    // Re-init monitoring via startBackgroundMonitoring or similar logic
    // Untuk simplenya, kita trigger startBackgroundMonitoring lagi 
    // tapi hanya akan menambah yang belum ada
    startBackgroundMonitoring(broadcastCallback).catch(console.error);
}

/**
 * Triggers an immediate refresh of secrets for a specific device.
 */
async function refreshSecretsNow(workspaceId, deviceId) {
    const logicalKey = `${workspaceId}:${deviceId}`;
    const physicalKey = logicalToPhysical.get(logicalKey);
    if (physicalKey) {
        const state = physicalMonitors.get(physicalKey);
        if (state) state.lastSecretFetch = 0;
    }
}

module.exports = { startBackgroundMonitoring, restartDeviceMonitor, stopDeviceMonitor, refreshSecretsNow };
