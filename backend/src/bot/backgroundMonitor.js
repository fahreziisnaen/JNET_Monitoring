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

// Track per-user online status to detect transitions
// Key: `${workspaceId}:${deviceId}:${pppoeUserName}` -> bool (wasActive)
const userStatusCache = new Map();

// Server start time for suppression
const serverStartTime = Date.now();
const SUPPRESSION_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

const BILLING_SYNC_MS = 30000;
let lastBillingWriteback = 0;

async function pruneBatched(sql, params, batch = 10000, maxBatches = 500) {
    for (let i = 0; i < maxBatches; i++) {
        const [r] = await pool.query(`${sql} LIMIT ${batch}`, params);
        if (!r.affectedRows || r.affectedRows < batch) break;
    }
}


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
        lastPruning: 0,          // Pruning hanya sekali per jam, bukan tiap siklus
        previousPppoeBytes: {}, // Cache tx/rx bytes dari cycle sebelumnya
        badInterfaces: new Set(), // Interface yang tidak support monitor-traffic, skip selanjutnya
        lastBadInterfaceReset: 0, // Reset bad list tiap 1 jam (jika interface kembali valid)
        failCount: 0,
        group: group, // Menyimpan list {workspace_id, id}
        broadcastCallback: broadcastCallback,
    };

    console.error(`[Pemantauan] Monitor FISIK AKTIF: ${label}`);

    const runCycle = async () => {
        const now = Date.now();

        try {
            // Gunakan device_id pertama sebagai perwakilan untuk runCommand
            const rep = group.devices[0];
            const workspaceId = rep.workspace_id;
            const deviceId = rep.id;

            // 1. Ambil data current secara paralel untuk menghemat puluhan-ratusan milidetik
            const [resource, pppoeActive, allInterfaces] = await Promise.all([
                runCommandForWorkspace(workspaceId, '/system/resource/print', [], deviceId)
                    .then(r => r ? r[0] : null).catch(() => null),
                runCommandForWorkspace(workspaceId, '/ppp/active/print', [], deviceId)
                    .catch(err => {
                        console.error(`[Pemantauan] Gagal mengambil daftar user aktif di ${label}: ${err.message}`);
                        return null;
                    }),
                runCommandForWorkspace(workspaceId, '/interface/print', [], deviceId)
                    .catch(() => [])
            ]);
            // Update status untuk SEMUA instance yang menggunakan router ini
            for (const inst of group.devices) {
                if (pppoeActive !== null) {
                    state.failCount = 0; // Reset on success
                    mikrotikStore.setActive(inst.workspace_id, inst.id, pppoeActive);
                    mikrotikStore.setDeviceStatus(inst.workspace_id, inst.id, 'connected');
                    mikrotikStore.setResource(inst.workspace_id, inst.id, resource || {});

                    // Update database untuk Dashboard Snapshot
                    pool.query(
                        'UPDATE mikrotik_devices SET last_known_cpu = ?, last_known_uptime = ?, last_known_active_users = ?, last_status_update = NOW() WHERE id = ?',
                        [resource?.['cpu-load'] || 0, resource?.['uptime'] || 'unknown', pppoeActive.length, inst.id]
                    ).catch(() => {});
                } else {
                    state.failCount++;
                    // Hanya set disconnected jika gagal lebih dari 2 kali (sekitar 30 detik jika interval 15s)
                    if (state.failCount >= 2) {
                        mikrotikStore.setDeviceStatus(inst.workspace_id, inst.id, 'disconnected');
                        pool.query('UPDATE mikrotik_devices SET last_status_update = NOW() WHERE id = ?', [inst.id]).catch(() => {});
                    }
                }
            }

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

            // TAMPUNG Traffic PPPoE Interfaces (Hitung BPS dari Byte Delta jika waktunya simpan DB)
            const pppoeBpsResults = {};
            const timeDeltaSec = (now - state.lastTrafficLog) / 1000;
            const SHIFT_TRAFFIC_LOG = now - state.lastTrafficLog >= 60000;

            if (SHIFT_TRAFFIC_LOG && timeDeltaSec > 0) {
                const currentPppoeBytes = {};
                
                allInterfaces.forEach(iface => {
                    const type = (iface.type || '').toLowerCase();
                    if (type.includes('pppoe-in') && iface.name) {
                        const txBytes = parseInt(iface['tx-byte'] || '0', 10);
                        const rxBytes = parseInt(iface['rx-byte'] || '0', 10);
                        
                        currentPppoeBytes[iface.name] = { tx: txBytes, rx: rxBytes };

                        // Kalkulasi BPS (Bits Per Second) jika ada data prev
                        if (state.previousPppoeBytes[iface.name]) {
                            const prev = state.previousPppoeBytes[iface.name];
                            
                            let txDelta = txBytes - prev.tx;
                            let rxDelta = rxBytes - prev.rx;
                            
                            // Handling counter reset (reboot/reconnect)
                            if (txDelta < 0) txDelta = txBytes;
                            if (rxDelta < 0) rxDelta = rxBytes;
                            
                            pppoeBpsResults[iface.name] = {
                                'tx-bits-per-second': Math.round((txDelta * 8) / timeDeltaSec),
                                'rx-bits-per-second': Math.round((rxDelta * 8) / timeDeltaSec)
                            };
                        }
                    }
                });
                
                // Simpan cache bytes sementara, jangan langsung ditimpa (agar bisa dipakai kalkulasi usage_logs di bawah)
                state.nextPppoeBytesTemp = currentPppoeBytes;
            }

            // Reset daftar bad interfaces setiap 1 jam agar interface baru bisa dicoba lagi
            if (now - state.lastBadInterfaceReset > 3600000) {
                state.badInterfaces.clear();
                state.lastBadInterfaceReset = now;
            }

            // Filter interface yang sudah diketahui tidak support monitor-traffic
            const monitorCandidates = interfacesToMonitor.filter(n => !state.badInterfaces.has(n));

            let trafficResults = [];
            if (monitorCandidates.length > 0) {
                const paramInterface = monitorCandidates.join(',');
                try {
                    const results = await runCommandForWorkspace(workspaceId, '/interface/monitor-traffic', [`=interface=${paramInterface}`, '=once='], deviceId);
                    trafficResults = Array.isArray(results) ? results : [results];
                } catch (err) {
                    if (err.message?.includes('match any value')) {
                        // Batch gagal — identifikasi interface bermasalah satu per satu
                        // Lakukan SEKALI ini saja untuk temukan yang bermasalah, lalu cache
                        for (const ifaceName of monitorCandidates) {
                            try {
                                const r = await runCommandForWorkspace(workspaceId, '/interface/monitor-traffic', [`=interface=${ifaceName}`, '=once='], deviceId);
                                const results = Array.isArray(r) ? r : [r];
                                trafficResults.push(...results.filter(Boolean));
                            } catch (_) {
                                // Interface ini tidak support monitor-traffic, masukkan ke blacklist
                                state.badInterfaces.add(ifaceName);
                            }
                        }
                        if (state.badInterfaces.size > 0) {
                            console.log(`[Pemantauan] ${label}: ${state.badInterfaces.size} interface tidak support monitor-traffic, akan dilewati: ${[...state.badInterfaces].join(', ')}`);
                        }
                    } else {
                        console.error(`[Pemantauan] Gagal monitor traffic massal: ${err.message}`);
                    }
                }
            }
            const traffic = {};
            trafficResults.forEach(result => {
                if (result && result.name) traffic[result.name] = result;
            });

            // Gabungkan traffic fisik dan PPPoE
            if (SHIFT_TRAFFIC_LOG && Object.keys(pppoeBpsResults).length > 0) {
                Object.assign(traffic, pppoeBpsResults);
            }

            // Simpan Traffic History ke DB per Workspace/Device
            if (SHIFT_TRAFFIC_LOG && Object.keys(traffic).length > 0) {
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

            // Simpan Resource Logs (CPU/Memory) ke DB per Workspace/Device (Historis untuk Laporan)
            if (SHIFT_TRAFFIC_LOG && resource) {
                for (const inst of group.devices) {
                    const cpuLoad = parseInt(resource['cpu-load'], 10) || 0;
                    const totalMemory = parseInt(resource['total-memory'], 10) || 0;
                    const freeMemory = parseInt(resource['free-memory'], 10) || 0;
                    const memoryUsage = totalMemory - freeMemory;

                    pool.query(
                        'INSERT INTO resource_logs (workspace_id, device_id, cpu_load, memory_usage) VALUES (?, ?, ?, ?)',
                        [inst.workspace_id, inst.id, cpuLoad, memoryUsage > 0 ? memoryUsage : 0]
                    ).catch(err => console.error(`[Pencatatan] Gagal simpan resource_logs: ${err.message}`));
                }
            }

            // ── AKUMULASI pppoe_usage_logs (Byte Harian per User) ──────────────────
            // Menggunakan data delta byte PPPoE yang sudah dihitung di atas.
            // Interface PPPoE-in bernama sama dengan username PPPoE (cth: "<pppoe-jnet123>")
            // pppoe_usage_logs HANYA diisi dari delta bytes, bukan dari BPS, agar akurat.
            if (SHIFT_TRAFFIC_LOG) {
                if (Object.keys(state.previousPppoeBytes).length > 0) {
                    for (const inst of group.devices) {
                        const usageInserts = [];
                        allInterfaces.forEach(iface => {
                            const type = (iface.type || '').toLowerCase();
                            if (!type.includes('pppoe-in') || !iface.name) return;

                            const prevBytes = state.previousPppoeBytes[iface.name];
                            if (!prevBytes) return; // Belum ada data sebelumnya, skip

                            const txBytes = parseInt(iface['tx-byte'] || '0', 10);
                            const rxBytes = parseInt(iface['rx-byte'] || '0', 10);

                            let txDelta = txBytes - prevBytes.tx;
                            let rxDelta = rxBytes - prevBytes.rx;

                            // Handling counter reset (reboot / reconnect)
                            if (txDelta < 0) txDelta = txBytes;
                            if (rxDelta < 0) rxDelta = rxBytes;

                            // Skip jika tidak ada pergerakan data sama sekali
                            if (txDelta === 0 && rxDelta === 0) return;

                            // Nama interface PPPoE-in biasanya "<pppoe-username>" — strip tag jika ada
                            const username = iface.name.replace(/^<(.+)>$/, '$1').replace(/^pppoe-/, '');

                            // tx = router kirim ke client = Download client
                            // rx = router terima dari client = Upload client
                            // Array untuk dimasukkan: [workspace_id, device_id, username, upload_bytes, download_bytes, total_bytes]
                            usageInserts.push([
                                inst.workspace_id, inst.id, username, rxDelta, txDelta, txDelta + rxDelta
                            ]);
                        });

                        if (usageInserts.length > 0) {
                            // Gunakan ON DUPLICATE KEY UPDATE untuk akumulasi harian
                            pool.query(`
                                INSERT INTO pppoe_usage_logs (workspace_id, device_id, pppoe_user, usage_date, upload_bytes, download_bytes, total_bytes)
                                VALUES ${usageInserts.map(() => '(?, ?, ?, CURDATE(), ?, ?, ?)').join(',')}
                                ON DUPLICATE KEY UPDATE
                                    upload_bytes   = upload_bytes   + VALUES(upload_bytes),
                                    download_bytes = download_bytes + VALUES(download_bytes),
                                    total_bytes    = total_bytes    + VALUES(total_bytes)
                            `, usageInserts.flatMap(r => r))
                            .catch(err => console.error(`[Pencatatan] Gagal akumulasi pppoe_usage_logs untuk workspace ${inst.workspace_id}: ${err.message}`));
                        }
                    }
                }
                
                // Terakhir, setelah semua insert disiapkan, kita timpa state-nya
                if (state.nextPppoeBytesTemp) {
                    state.previousPppoeBytes = state.nextPppoeBytesTemp;
                }
            }
            // ────────────────────────────────────────────────────────────────────────

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
                    const [clientData] = await pool.query('SELECT pppoe_secret_name, client_name, whatsapp_number FROM clients WHERE workspace_id = ? AND (device_id = ? OR device_id IS NULL)', [inst.workspace_id, inst.id]).catch(() => [[]]);
                    const clientMap = new Map();
                    clientData.forEach(c => clientMap.set(c.pppoe_secret_name, c));

                    const currentSecrets = mikrotikStore.getSecrets(inst.workspace_id, inst.id) || [];
                    const enriched = currentSecrets
                        .filter(s => !mikrotikStore.isPendingDelete(inst.workspace_id, inst.id, s.name))
                        .map(secret => {
                            const activeInfo = activeMap.get(secret.name);
                            const enrichedSecret = { 
                                ...secret, 
                                isActive: !!activeInfo,
                                router_name: inst.name,
                                workspace_name: inst.workspace_name
                            };

                            const clientInfo = clientMap.get(secret.name);
                            if (clientInfo) {
                                enrichedSecret.client_name = clientInfo.client_name;
                                enrichedSecret.whatsapp_number = clientInfo.whatsapp_number;
                            }

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

                        // --- AUTO PRUNING ---
                        // Jika secret ada di database JNET tapi sudah tidak ada di Mikrotik (dihapus via WinBox), 
                        // maka hapus juga dari database agar sinkron.
                        const allFetchedNames = enriched.map(s => s.name);
                        if (allFetchedNames.length > 0) {
                            // 1. Hapus dari pppoe_secrets
                            await pool.query(
                                'DELETE FROM pppoe_secrets WHERE workspace_id = ? AND device_id = ? AND name NOT IN (?)',
                                [inst.workspace_id, inst.id, allFetchedNames]
                            ).catch(e => console.error(`[Pruning] Gagal hapus pppoe_secrets: ${e.message}`));

                            // 2. Hapus dari clients (Data Map / Koordinat)
                            // User meminta ini otomatis juga ("iya buat auto")
                            await pool.query(
                                'DELETE FROM clients WHERE workspace_id = ? AND device_id = ? AND pppoe_secret_name NOT IN (?)',
                                [inst.workspace_id, inst.id, allFetchedNames]
                            ).catch(e => console.error(`[Pruning] Gagal hapus clients: ${e.message}`));

                            // 3. Hapus dari odp_user_connections
                            await pool.query(
                                'DELETE FROM odp_user_connections WHERE workspace_id = ? AND pppoe_secret_name NOT IN (?)',
                                [inst.workspace_id, allFetchedNames]
                            ).catch(e => console.error(`[Pruning] Gagal hapus odp_user_connections: ${e.message}`));
                        }

                        // 4. Pruning Notifikasi Lama (lebih dari 7 Hari)
                        await pool.query(
                            'DELETE FROM app_notifications WHERE workspace_id = ? AND created_at < NOW() - INTERVAL 7 DAY',
                            [inst.workspace_id]
                        ).catch(e => console.error(`[Pruning] Gagal hapus notifikasi lama: ${e.message}`));

                        // 5. Pruning Log Trafik Lama — hanya sekali per jam untuk hindari deadlock
                        const PRUNING_INTERVAL_MS = 60 * 60 * 1000; // 1 jam
                        if (now - state.lastPruning >= PRUNING_INTERVAL_MS) {
                            state.lastPruning = now;
                            pruneBatched(
                                'DELETE FROM interface_traffic_logs WHERE workspace_id = ? AND timestamp < NOW() - INTERVAL 3 MONTH',
                                [inst.workspace_id]
                            ).catch(e => console.error(`[Pruning] Gagal hapus log trafik 3-bulan: ${e.message}`));

                            // 6. Pruning Log Penggunaan Kuota PPPoE (maksimal 3 Bulan = ~90 Hari)
                            pruneBatched(
                                'DELETE FROM pppoe_usage_logs WHERE workspace_id = ? AND usage_date < NOW() - INTERVAL 3 MONTH',
                                [inst.workspace_id]
                            ).catch(e => console.error(`[Pruning] Gagal hapus log pppoe usage 3-bulan: ${e.message}`));
                        }

                        // --- SLA TRACKING ---
                        const isSuppressed = Date.now() - serverStartTime < SUPPRESSION_PERIOD_MS;
                        
                        if (activeUsers.length > 0) {
                            await pool.query(`UPDATE downtime_events SET end_time=NOW(), duration_seconds=TIMESTAMPDIFF(SECOND, start_time, NOW()) WHERE workspace_id=? AND device_id=? AND pppoe_user IN (?) AND end_time IS NULL`, [inst.workspace_id, inst.id, activeUsers.map(u=>u.name)]).catch(() => {});
                        }
                        
                        // Only create NEW downtime events if NOT in suppression period
                        // This avoids creating "fresh" records for users who were already offline before restart
                        if (!isSuppressed) {
                            const eligibleForDowntime = enriched.filter(s => !s.isActive && (s.disabled === 0 || s.disabled === false || s.disabled === 'false'));
                            for (const user of eligibleForDowntime) {
                                const [open] = await pool.query('SELECT id FROM downtime_events WHERE workspace_id=? AND device_id=? AND pppoe_user=? AND end_time IS NULL', [inst.workspace_id, inst.id, user.name]).catch(()=>[[]]);
                                if (open.length === 0) {
                                    await pool.query('INSERT INTO downtime_events (workspace_id, device_id, pppoe_user, start_time) VALUES (?, ?, ?, NOW())', [inst.workspace_id, inst.id, user.name]).catch(() => {});
                                }
                            }
                        }

                        const downSecMap = new Map();
                        if (inactiveNames.length > 0) {
                            const [downs] = await pool.query('SELECT pppoe_user, TIMESTAMPDIFF(SECOND, start_time, NOW()) AS secs FROM downtime_events WHERE workspace_id=? AND device_id=? AND end_time IS NULL AND pppoe_user IN (?)', [inst.workspace_id, inst.id, inactiveNames]).catch(() => [[]]);
                            downs.forEach(d => downSecMap.set(d.pppoe_user, d.secs));
                        }
                        enriched.forEach(s => { if (!s.isActive) s.downSeconds = downSecMap.get(s.name) ?? null; });

                        // --- REALTIME TOAST NOTIFICATION BROADCAST ---
                        // 1. Always update cache to maintain baseline
                        for (const secret of enriched) {
                            const cacheKey = `${inst.workspace_id}:${inst.id}:${secret.name}`;
                            const wasActive = userStatusCache.get(cacheKey);
                            
                            // 2. Only notify if:
                            // - Suppression period is over
                            // - We have a valid baseline (wasActive is not undefined)
                            // - Status actually changed
                            if (!isSuppressed && wasActive !== undefined && state.broadcastCallback) {
                                if (secret.disabled !== true && secret.disabled !== 'true' && secret.disabled !== 1) {
                                    if (wasActive && !secret.isActive) {
                                        // Transition: Online -> Offline
                                        state.broadcastCallback(inst.workspace_id, inst.id, {
                                            type: 'downtime-notification',
                                            payload: { users: [secret.name], deviceName: inst.name }
                                        });
                                        // Simpan riwayat secara permanen ke database
                                        pool.query('INSERT INTO app_notifications (workspace_id, type, title, message) VALUES (?, ?, ?, ?)', [
                                            inst.workspace_id, 'disconnect', 'PPPoE User Disconnected', `${secret.name} terputus dari jaringan pada perangkat ${inst.name}.`
                                        ]).catch(() => {});
                                    } else if (!wasActive && secret.isActive) {
                                        // Transition: Offline -> Online
                                        state.broadcastCallback(inst.workspace_id, inst.id, {
                                            type: 'reconnect-notification',
                                            payload: { users: [secret.name], deviceName: inst.name }
                                        });
                                        // Simpan riwayat secara permanen ke database
                                        pool.query('INSERT INTO app_notifications (workspace_id, type, title, message) VALUES (?, ?, ?, ?)', [
                                            inst.workspace_id, 'reconnect', 'PPPoE User Reconnected', `${secret.name} kembali terhubung pada perangkat ${inst.name}.`
                                        ]).catch(() => {});
                                    }
                                }
                            }

                            // Always update cache
                            userStatusCache.set(cacheKey, secret.isActive);
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

            if (now - lastBillingWriteback >= BILLING_SYNC_MS) {
                lastBillingWriteback = now;
                pool.query(
                    `UPDATE billing_subscriptions s
                     JOIN billing_customers c ON c.id = s.customer_id
                     SET s.status = 'suspended'
                     WHERE s.status = 'active'
                       AND EXISTS (SELECT 1 FROM pppoe_secrets ps
                                   WHERE ps.workspace_id = c.workspace_id AND ps.name = c.pppoe_secret_name
                                     AND (c.device_id IS NULL OR ps.device_id = c.device_id)
                                     AND LOWER(ps.profile) = 'isolir')`
                ).then(([r]) => { if (r.affectedRows) console.log(`[Billing][Sync] ${r.affectedRows} langganan → suspended (isolir router)`); })
                 .catch(e => console.error(`[Billing][Sync] gagal: ${e.message}`));
            }

        } catch (err) {
            console.error(`[Pemantauan] Gangguan siklus ${label}: ${err.message}`);
        } finally {
            state.isRunning = false;
        }
    };

    state.runCycle = async (isManual = false) => {
        if (state.isRunning) {
            if (isManual) state.lastSecretFetch = 0;
            return;
        }

        if (state.timeoutId) {
            clearTimeout(state.timeoutId);
            state.timeoutId = null;
        }

        state.isRunning = true;
        const cycleStart = Date.now();
        try {
            await runCycle();
        } finally {
            state.isRunning = false;
            // Kompensasi delay eksekusi: Pastikan script berjalan TEPAT setiap 3 detik, bukan 3 detik + waktu eksekusi runCycle
            const elapsed = Date.now() - cycleStart;
            const nextTimeout = Math.max(100, POLLING_INTERVAL_MS - elapsed);
            if (!state.stopped) state.timeoutId = setTimeout(() => state.runCycle(), nextTimeout);
        }
    };

    physicalMonitors.set(physicalKey, state);
    state.timeoutId = setTimeout(() => state.runCycle(), 500);
}

async function startBackgroundMonitoring(broadcastCallback = null) {
    console.error('[Sistem] Memulai layanan pemantauan latar belakang (Optimized)...');
    try {
        const [devices] = await pool.query(`
            SELECT d.*, w.name as workspace_name 
            FROM mikrotik_devices d 
            JOIN workspaces w ON d.workspace_id = w.id
        `);
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
            
            // Simpan metadata ke global store untuk broadcast yang lebih lengkap
            mikrotikStore.setDeviceInfo(device.workspace_id, device.id, {
                name: device.name,
                workspaceName: device.workspace_name
            });
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
            // Loop polling memakai setTimeout berantai, jadi hentikan timer + tandai agar siklus berjalan tidak menjadwal ulang
            state.stopped = true;
            if (state.timeoutId) clearTimeout(state.timeoutId);
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
        if (state) {
            console.log(`[Sync] Triggering immediate refresh for device ${deviceId} (Workspace: ${workspaceId})`);
            state.lastSecretFetch = 0; // Force heavy fetch
            // Trigger siklus sekarang juga tanpa menunggu timeout 3 detik
            state.runCycle(true).catch(() => {});
        }
    }
}

module.exports = { startBackgroundMonitoring, restartDeviceMonitor, stopDeviceMonitor, refreshSecretsNow };
