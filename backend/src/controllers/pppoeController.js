const { runCommandForWorkspace } = require('../utils/apiConnection');
const pool = require('../config/database');
const mikrotikStore = require('../utils/mikrotikStore');

// Helper functions for IP manipulation
const ipToLong = (ip) => {
    // Bersihkan CIDR jika ada (misal 192.168.1.0/24 -> 192.168.1.0)
    const cleanIp = ip.split('/')[0];
    return cleanIp.split('.').reduce((long, octet) => (long << 8) + parseInt(octet), 0) >>> 0;
};

const longToIp = (long) => {
    return [
        (long >>> 24) & 0xFF,
        (long >>> 16) & 0xFF,
        (long >>> 8) & 0xFF,
        long & 0xFF
    ].join('.');
};

const isIpAddress = (ip) => {
    const regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return regex.test(ip || '');
};

exports.getSummary = async (req, res) => {
    const startTime = Date.now();
    try {
        const workspaceId = req.user.workspace_id;
        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;


        // Jalankan secara sequential untuk menghindari deadlock dengan locking mechanism
        // Kedua command akan menggunakan koneksi yang sama (karena deviceId sama)
        // Locking mechanism akan memastikan hanya satu koneksi dibuat dan di-reuse
        const secrets = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', ['.proplist=.id'], deviceId);
        const active = await runCommandForWorkspace(workspaceId, '/ppp/active/print', ['.proplist=.id', '?service=pppoe'], deviceId).catch(() => []);

        const duration = Date.now() - startTime;
        console.log(`[PPPoE Summary] Berhasil dalam ${duration}ms - total: ${secrets.length}, active: ${active.length}`);

        res.json({ total: secrets.length, active: active.length, inactive: secrets.length - active.length });
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[PPPoE Summary] Error setelah ${duration}ms:`, error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.getSecrets = async (req, res) => {
    const startTime = Date.now();
    try {
        const workspaceId = req.user.workspace_id;
        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
        const disabled = req.query.disabled;


        // Optimasi: Cek di local store dulu (instant)
        let secrets = mikrotikStore.getSecrets(workspaceId);
        let activeUsers = mikrotikStore.getActive(workspaceId);

        // Jika store kosong (monitoring belum jalan), fallback ke API (slow)
        if (!secrets || secrets.length === 0) {
            console.log(`[getSecrets] Store kosong, fallback ke MikroTik API...`);
            secrets = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [
                '.proplist=.id,name,profile,remote-address,last-logged-out,disabled'
            ], deviceId);

            activeUsers = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [
                '.proplist=name,address,.id',
                '?service=pppoe'
            ], deviceId).catch((err) => {
                console.warn(`[PPPoE Secrets] Error fetching active users:`, err.message);
                return [];
            });
        }

        // Filter berdasarkan disabled jika diperlukan
        let filteredSecrets = secrets;
        if (disabled === 'false') {
            filteredSecrets = secrets.filter(s => s.disabled !== 'true');
        } else if (disabled === 'true') {
            filteredSecrets = secrets.filter(s => s.disabled === 'true');
        }

        // Buat Map dari active users untuk lookup cepat (name -> address)
        // Active users memiliki IP address yang sedang digunakan
        const activeUserMap = new Map();
        activeUsers.forEach(user => {
            if (user.name && user.address) {
                activeUserMap.set(user.name, user.address);
            }
        });

        // Buat Set dari nama user yang aktif untuk lookup cepat
        const activeUserNames = new Set(activeUsers.map(user => user.name));

        // Tambahkan informasi isActive ke setiap secret dan pastikan semua field ter-preserve
        const secretsWithStatus = filteredSecrets.map(secret => {
            // Build object dengan semua field dari secret
            // Gunakan Object.assign untuk memastikan semua field ter-copy termasuk yang dengan tanda hubung
            const secretData = Object.assign({}, secret);

            // Untuk remote-address:
            // 1. Jika secret memiliki remote-address yang di-set, gunakan itu
            // 2. Jika user sedang aktif, gunakan IP dari active connection
            // 3. Jika tidak ada, set null
            let remoteAddress = secret['remote-address'] || null;

            // Jika tidak ada remote-address di secret tapi user sedang aktif, ambil dari active connection
            if (!remoteAddress && activeUserMap.has(secret.name)) {
                remoteAddress = activeUserMap.get(secret.name);
            }

            // Set remote-address (selalu ada di response, meskipun null)
            secretData['remote-address'] = remoteAddress;

            // Tambahkan isActive
            secretData.isActive = activeUserNames.has(secret.name);

            return secretData;
        });

        const duration = Date.now() - startTime;
        console.log(`[PPPoE Secrets] Berhasil dalam ${duration}ms - total secrets: ${secrets.length}, filtered: ${filteredSecrets.length}`);

        res.json(secretsWithStatus);
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[PPPoE Secrets] Error setelah ${duration}ms:`, error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.getNextIp = async (req, res) => {
    const { profile } = req.query;
    const { workspace_id } = req.user;
    var activeUsedIpsSet = new Set(); // Gunakan var dan nama unik untuk hindari scope issues

    if (!profile) {
        return res.status(400).json({ message: 'Profil tidak boleh kosong.' });
    }

    console.log(`[Next IP] Request untuk profil: "${profile}" di workspace: ${workspace_id}`);

    try {
        const [pools] = await pool.query(
            'SELECT ip_start, ip_end, gateway FROM ip_pools WHERE workspace_id = ? AND profile_name = ?',
            [workspace_id, profile]
        );

        if (pools.length === 0) {
            return res.status(404).json({ message: `IP Pool untuk profil "${profile}" belum diatur.` });
        }

        const { ip_start, ip_end, gateway } = pools[0];

        // OPTIMIZATION: Ambil data dari local store (instant)
        const allSecrets = mikrotikStore.getSecrets(workspace_id) || [];
        const allActive = mikrotikStore.getActive(workspace_id) || [];

        // 1. IP dari semua PPPoE Secrets
        allSecrets.forEach(s => {
            if (s['remote-address']) activeUsedIpsSet.add(s['remote-address']);
        });

        // 2. IP dari semua koneksi yang sedang ONLINE
        allActive.forEach(a => {
            if (a.address) activeUsedIpsSet.add(a.address);
        });

        // --- CIDR AND RANGE LOGIC ---
        let startLong, endLong;

        if (ip_start.includes('/')) {
            const [baseIp, mask] = ip_start.split('/');
            const maskInt = parseInt(mask);
            const baseLong = ipToLong(baseIp);

            const fullMask = (0xFFFFFFFF << (32 - maskInt)) >>> 0;
            const networkLong = (baseLong & fullMask) >>> 0;
            const broadcastLong = (networkLong | (~fullMask)) >>> 0;

            startLong = networkLong + 1;
            endLong = broadcastLong - 1;
        } else {
            startLong = ipToLong(ip_start);
            endLong = ipToLong(ip_end);
        }

        const gatewayLong = ipToLong(gateway);
        let nextIp = null;

        console.log(`[Next IP] Searching range: ${longToIp(startLong)} - ${longToIp(endLong)}. Used count: ${activeUsedIpsSet.size}`);

        for (let currentLong = startLong; currentLong <= endLong; currentLong++) {
            const currentIpStr = longToIp(currentLong);

            if (!activeUsedIpsSet.has(currentIpStr) && currentLong !== gatewayLong) {
                nextIp = currentIpStr;
                break;
            }
        }

        if (!nextIp) {
            console.warn(`[Next IP] POOL EXHAUSTED for "${profile}"`);
            return res.status(409).json({ message: 'Semua IP dalam pool ini sudah terpakai.' });
        }

        res.json({
            remoteAddress: nextIp,
            localAddress: isIpAddress(gateway) ? gateway : null
        });

    } catch (error) {
        console.error("GET NEXT IP FATAL ERROR:", error);
        res.status(500).json({ message: error.message || 'Error mencari IP.' });
    }
};

exports.addSecret = async (req, res) => {
    const { name, password, profile, service = 'pppoe', localAddress, remoteAddress } = req.body;
    if (!name || !password || !profile) {
        return res.status(400).json({ message: 'Nama, password, dan profile wajib diisi.' });
    }

    const requestId = Math.random().toString(36).substring(7);
    console.log(`[Add Secret][${requestId}] Request baru untuk "${name}" (Profile: ${profile})`);

    try {
        try {
            console.log(`[Add Secret][${requestId}] Pengecekan proaktif via local store (instant)...`);
            const localSecrets = mikrotikStore.getSecrets(req.user.workspace_id);
            const isExisting = localSecrets.some(s => s.name === name);

            if (isExisting) {
                console.log(`[Add Secret][${requestId}] Proactive Detect (Cache): Secret sudah ada. Menanggapi sukses.`);
                return res.status(201).json({
                    message: `Secret untuk ${name} sudah siap di MikroTik.`,
                    isIdempotent: true
                });
            }

            // Jika tidak ada di cache, kita boleh lanjut tetap melakukan /add langsung
            // Mencegah lambatnya /print di router yang sedang sibuk.
        } catch (checkError) {
            console.warn(`[Add Secret][${requestId}] Pengecekan cache gagal, lanjut ke upaya pembuatan...`);
        }

        const params = [
            `=name=${name}`,
            `=password=${password}`,
            `=profile=${profile}`,
            `=service=${service}`
        ];

        // Hanya tambahkan jika itu IP yang valid (hindari nilai seperti "Lokal")
        if (isIpAddress(localAddress)) params.push(`=local-address=${localAddress}`);
        if (isIpAddress(remoteAddress)) params.push(`=remote-address=${remoteAddress}`);

        console.log(`[Add Secret][${requestId}] Mengirim command /add ke MikroTik...`);
        await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/add', params);
        console.log(`[Add Secret][${requestId}] Berhasil membuat secret.`);
        res.status(201).json({ message: `Secret untuk ${name} berhasil dibuat.` });
    } catch (error) {
        const rawMessage = error.message || '';
        const errorMessage = rawMessage.toLowerCase();
        console.warn(`[Add Secret][${requestId}] Gagal: "${rawMessage}"`);

        // POSITIVE 1: Deteksi variasi "already exists" jika race condition tetap terjadi
        if (errorMessage.includes('exists') || errorMessage.includes('sudah ada') || errorMessage.includes('ada')) {
            console.log(`[Add Secret][${requestId}] Idempotensi (Post-Add): Data sudah ada di router. Menanggapi sukses.`);
            return res.status(201).json({
                message: `Secret untuk ${name} sudah tersedia di MikroTik.`,
                isIdempotent: true
            });
        }

        console.warn(`[Add Secret] Initial add failed for "${name}", performing Fast Verification Flight...`, error.message);

        try {
            // Fast Verification Flight: No retry, 10s timeout
            const checkSecret = await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/print', [
                '.proplist=.id,name',
                `?name=${name}`
            ], null, { noRetry: true, timeout: 10000 });

            if (checkSecret && checkSecret.length > 0) {
                console.log(`[Add Secret] Fast Verification success for "${name}": Secret exists.`);
                return res.status(201).json({
                    message: `Secret untuk ${name} berhasil disinkronkan.`,
                    isIdempotent: true
                });
            }
        } catch (verifyError) {
            console.error(`[Add Secret] Fast Verification failed for "${name}":`, verifyError.message);
        }

        // Jika verifikasi gagal atau tidak menemukan data, kembalikan error asli
        res.status(500).json({ message: error.message });
    }
};

exports.getProfiles = async (req, res) => {
    try {
        const profiles = await runCommandForWorkspace(req.user.workspace_id, '/ppp/profile/print', ['.proplist=name']);
        // Extract profile names dan urutkan secara ascending
        const profileNames = profiles.map(p => p.name).sort((a, b) => {
            // Case-insensitive sorting
            return a.toLowerCase().localeCompare(b.toLowerCase());
        });
        res.json(profileNames);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.setSecretStatus = async (req, res) => {
    const { id } = req.params;
    const { disabled } = req.body;
    try {
        await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/set', [`=.id=${id}`, `=disabled=${disabled}`]);
        res.status(200).json({ message: `Secret berhasil di-${disabled === 'true' ? 'disable' : 'enable'}.` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

exports.kickActiveUser = async (req, res) => {
    const { id } = req.params;
    try {
        await runCommandForWorkspace(req.user.workspace_id, '/ppp/active/remove', [`=.id=${id}`]);
        res.status(200).json({ message: 'Koneksi pengguna berhasil diputuskan.' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

exports.getSlaDetails = async (req, res) => {
    const { name } = req.params;
    const workspaceId = req.user.workspace_id;

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Hitung downtime yang sudah selesai (dengan duration_seconds)
        const [completedDowntimeResult] = await pool.query(
            `SELECT COALESCE(SUM(duration_seconds), 0) as total_downtime
            FROM downtime_events
            WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NOT NULL`,
            [workspaceId, name, thirtyDaysAgo]
        );
        const completedDowntimeSeconds = parseInt(completedDowntimeResult[0].total_downtime, 10);

        // Hitung downtime yang masih berlangsung (end_time IS NULL)
        const [ongoingDowntimeResult] = await pool.query(
            `SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_time, NOW())), 0) as ongoing_downtime
            FROM downtime_events
            WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NULL`,
            [workspaceId, name, thirtyDaysAgo]
        );
        const ongoingDowntimeSeconds = parseInt(ongoingDowntimeResult[0].ongoing_downtime, 10);

        const totalDowntimeSeconds = completedDowntimeSeconds + ongoingDowntimeSeconds;

        const totalSecondsInPeriod = 30 * 24 * 60 * 60;
        const uptimeSeconds = totalSecondsInPeriod - totalDowntimeSeconds;
        const slaPercentage = (uptimeSeconds / totalSecondsInPeriod) * 100;
        const [downtimeEvents] = await pool.query(
            `SELECT start_time, 
                    CASE 
                        WHEN end_time IS NULL THEN TIMESTAMPDIFF(SECOND, start_time, NOW())
                        ELSE duration_seconds 
                    END as duration_seconds,
                    end_time IS NULL as is_ongoing
             FROM downtime_events 
             WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ?
             ORDER BY start_time DESC LIMIT 5`,
            [workspaceId, name, thirtyDaysAgo]
        );

        res.json({
            sla_percentage: slaPercentage.toFixed(4),
            total_downtime_seconds: totalDowntimeSeconds,
            recent_events: downtimeEvents
        });

    } catch (error) {
        console.error(`Error getting SLA for ${name}:`, error);
        res.status(500).json({ message: 'Gagal mengambil detail SLA.', error: error.message });
    }
};

exports.updateSecret = async (req, res) => {
    const { id } = req.params;
    const { password, profile } = req.body;
    if (!profile) {
        return res.status(400).json({ message: 'Profil wajib diisi.' });
    }
    try {
        const params = [`=.id=${id}`, `=profile=${profile}`];
        if (password) {
            params.push(`=password=${password}`);
        }
        await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/set', params);
        res.status(200).json({ message: 'Secret berhasil diperbarui.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteSecret = async (req, res) => {
    const { id } = req.params;
    try {
        console.log(`[Delete Secret] Request hapus secret ID: ${id} untuk workspace: ${req.user.workspace_id}`);
        await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/remove', [`=.id=${id}`]);
        console.log(`[Delete Secret] Berhasil hapus id: ${id}`);
        res.status(200).json({ message: 'Secret berhasil dihapus.' });
    } catch (error) {
        console.error(`[Delete Secret] Gagal hapus id: ${id}: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

exports.getUsageHistory = async (req, res) => {
    const { name } = req.params;
    const workspaceId = req.user.workspace_id;

    // Perbaiki logika perhitungan:
    // - daily: hanya data hari ini (usage_date = CURDATE())
    // - weekly: data 7 hari terakhir termasuk hari ini (usage_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY))
    // - monthly: data 30 hari terakhir termasuk hari ini (usage_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY))
    const query = `
        SELECT 
            SUM(CASE WHEN DATE(usage_date) = CURDATE() THEN total_bytes ELSE 0 END) as daily,
            SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN total_bytes ELSE 0 END) as weekly,
            SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN total_bytes ELSE 0 END) as monthly
        FROM pppoe_usage_logs
        WHERE workspace_id = ? AND pppoe_user = ? AND DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY);
    `;

    try {
        const [results] = await pool.query(query, [workspaceId, name]);
        const usage = {
            daily: results[0].daily || 0,
            weekly: results[0].weekly || 0,
            monthly: results[0].monthly || 0,
        };
        res.json(usage);
    } catch (error) {
        console.error(`Error getting usage history for ${name}:`, error);
        res.status(500).json({ message: 'Gagal mengambil riwayat pemakaian.' });
    }
};