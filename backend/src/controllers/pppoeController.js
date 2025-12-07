const { runCommandForWorkspace } = require('../utils/apiConnection');
const pool = require('../config/database');

exports.getSummary = async (req, res) => {
    const startTime = Date.now();
    try {
        const workspaceId = req.user.workspace_id;
        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
        console.log(`[PPPoE Summary] Request untuk workspace ${workspaceId}, deviceId ${deviceId}`);
        
        // Jalankan secara sequential untuk menghindari deadlock dengan locking mechanism
        // Kedua command akan menggunakan koneksi yang sama (karena deviceId sama)
        // Locking mechanism akan memastikan hanya satu koneksi dibuat dan di-reuse
        const secrets = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [], deviceId);
        const active = await runCommandForWorkspace(workspaceId, '/ppp/active/print', ['?service=pppoe'], deviceId).catch(() => []);
        
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
        console.log(`[PPPoE Secrets] Request untuk workspace ${workspaceId}, deviceId ${deviceId}, disabled=${disabled}`);
        
        // Timeout sudah di-handle di runCommandForWorkspace
        // Ambil secrets dan active users secara sequential untuk menghindari race condition
        // Kedua command akan menggunakan koneksi yang sama (karena deviceId sama)
        // Locking mechanism akan memastikan hanya satu koneksi dibuat dan di-reuse
        console.log(`[PPPoE Secrets] Memulai fetch secrets untuk deviceId ${deviceId}`);
        const secretsStartTime = Date.now();
        const secrets = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [], deviceId);
        console.log(`[PPPoE Secrets] Secrets fetched dalam ${Date.now() - secretsStartTime}ms, jumlah: ${secrets.length}`);
        
        const activeStartTime = Date.now();
        const activeUsers = await runCommandForWorkspace(workspaceId, '/ppp/active/print', ['?service=pppoe'], deviceId).catch((err) => {
            console.warn(`[PPPoE Secrets] Error fetching active users:`, err.message);
            return []; // Return empty array jika error
        });
        console.log(`[PPPoE Secrets] Active users fetched dalam ${Date.now() - activeStartTime}ms, jumlah: ${activeUsers.length}`);
        
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

    if (!profile) {
        return res.status(400).json({ message: 'Profil tidak boleh kosong.' });
    }

    try {
        const [pools] = await pool.query(
            'SELECT ip_start, ip_end, gateway FROM ip_pools WHERE workspace_id = ? AND profile_name = ?',
            [workspace_id, profile]
        );

        if (pools.length === 0) {
            return res.status(404).json({ message: `IP Pool untuk profil "${profile}" belum diatur.` });
        }

        const { ip_start, ip_end, gateway } = pools[0];
        
        const secrets = await runCommandForWorkspace(workspace_id, '/ppp/secret/print', [`?profile=${profile}`]);
        
        const usedIps = new Set(secrets.map(s => s['remote-address']).filter(Boolean));
        const startIp = ip_start.split('.').map(Number);
        const endIp = ip_end.split('.').map(Number);
        let nextIp = null;

        for (let i = startIp[3]; i <= endIp[3]; i++) {
            const currentIp = `${startIp[0]}.${startIp[1]}.${startIp[2]}.${i}`;
            if (!usedIps.has(currentIp) && currentIp !== gateway) {
                nextIp = currentIp;
                break;
            }
        }

        if (!nextIp) {
            return res.status(409).json({ message: 'Semua IP dalam pool ini sudah terpakai.' });
        }

        res.json({ remoteAddress: nextIp, localAddress: gateway });

    } catch (error) {
        console.error("GET NEXT IP ERROR:", error);
        res.status(500).json({ message: error.message || 'Terjadi kesalahan di server saat mencari IP.' });
    }
};

exports.addSecret = async (req, res) => {
    const { name, password, profile, service = 'pppoe', localAddress, remoteAddress } = req.body;
    if (!name || !password || !profile) {
        return res.status(400).json({ message: 'Nama, password, dan profile wajib diisi.' });
    }

    try {
        const params = [
            `=name=${name}`,
            `=password=${password}`,
            `=profile=${profile}`,
            `=service=${service}`
        ];
        if (localAddress) params.push(`=local-address=${localAddress}`);
        if (remoteAddress) params.push(`=remote-address=${remoteAddress}`);

        await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/add', params);
        res.status(201).json({ message: `Secret untuk ${name} berhasil dibuat.` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getProfiles = async (req, res) => {
    try {
        const profiles = await runCommandForWorkspace(req.user.workspace_id, '/ppp/profile/print');
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
        await runCommandForWorkspace(req.user.workspace_id, '/ppp/secret/remove', [`=.id=${id}`]);
        res.status(200).json({ message: 'Secret berhasil dihapus.' });
    } catch (error) {
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