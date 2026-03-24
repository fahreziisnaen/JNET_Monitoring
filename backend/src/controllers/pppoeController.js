const { runCommandForWorkspace } = require('../utils/apiConnection');
const pool = require('../config/database');
const mikrotikStore = require('../utils/mikrotikStore');
const { refreshSecretsNow } = require('../bot/backgroundMonitor');
const broadcast = require('../utils/broadcast');
const fs = require('fs');
const path = require('path');

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

const resolveSecretId = async (workspace_id, identifier, deviceId) => {
    if (identifier.startsWith('*')) return identifier;
    const data = await runCommandForWorkspace(workspace_id, '/ppp/secret/print', [`?name=${identifier}`], deviceId);
    if (!data || data.length === 0) throw new Error(`Secret '${identifier}' tidak ditemukan di router Mikrotik.`);
    return data[0]['.id'];
};

exports.getSummary = async (req, res) => {
    const startTime = Date.now();
    try {
        let workspaceId = req.user.workspace_id;
        
        // Support override for NOC / Admin / Superadmin
        const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
        if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
            workspaceId = parseInt(req.query.workspaceId);
        }

        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

        let query = 'SELECT COUNT(*) as total, SUM(is_active = 1) as active FROM pppoe_secrets WHERE workspace_id = ?';
        let params = [workspaceId];

        if (deviceId) {
            query += ' AND device_id = ?';
            params.push(deviceId);
        }

        const [rows] = await pool.query(query, params);
        const { total = 0, active = 0 } = rows[0] || {};
        const inactive = total - active;

        const duration = Date.now() - startTime;
        console.log(`[PPPoE Summary] Berhasil dalam ${duration}ms - total: ${total}, active: ${active}`);

        res.json({ total: Number(total), active: Number(active), inactive: Number(inactive) });
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[PPPoE Summary] Error setelah ${duration}ms:`, error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.getSecrets = async (req, res) => {
    const startTime = Date.now();
    try {
        let workspaceId = req.user.workspace_id;
        
        // Support override for NOC / Admin / Superadmin
        const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
        if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
            workspaceId = parseInt(req.query.workspaceId);
        }

        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
        const disabled = req.query.disabled;

        let query = `
            SELECT 
                device_id as deviceId,
                name, 
                profile, 
                remote_address as 'remote-address', 
                current_address as currentAddress,
                disabled, 
                is_active as isActive, 
                uptime, 
                active_connection_id as activeConnectionId
            FROM pppoe_secrets 
            WHERE workspace_id = ?
        `;
        let params = [workspaceId];

        if (deviceId) {
            query += ' AND device_id = ?';
            params.push(deviceId);
        }

        if (disabled === 'true') {
            query += ' AND disabled = 1';
        } else if (disabled === 'false') {
            query += ' AND disabled = 0';
        }

        query += ' ORDER BY name ASC';

        const [secretsWithStatus] = await pool.query(query, params);
        
        // Format boolean disabled and field mapping
        const formattedSecrets = secretsWithStatus.map(s => {
            const secret = { ...s };
            secret.disabled = s.disabled === 1 ? 'true' : 'false';
            secret.isActive = s.isActive === 1;
            
            // Replicate original behavior where active IP overrides remote-address if remote-address is empty
            if (!secret['remote-address'] && secret.currentAddress) {
                secret['remote-address'] = secret.currentAddress;
            }
            
            return secret;
        });

        const duration = Date.now() - startTime;
        console.log(`[PPPoE Secrets] Berhasil dalam ${duration}ms - total secrets: ${formattedSecrets.length}`);

        res.json(formattedSecrets);
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[PPPoE Secrets] Error setelah ${duration}ms:`, error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.getNextIp = async (req, res) => {
    const { profile } = req.query;
    let workspace_id = req.user.workspace_id;
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspace_id = parseInt(req.query.workspaceId);
    }
    var activeUsedIpsSet = new Set();

    if (!profile) {
        return res.status(400).json({ message: 'Profil tidak boleh kosong.' });
    }

    console.log(`[Next IP] Request untuk profil: "${profile}" di workspace: ${workspace_id}`);

    try {
        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
        if (!deviceId) {
            return res.status(400).json({ message: 'Device ID wajib disertakan.' });
        }

        const [pools] = await pool.query(
            'SELECT ip_start, ip_end, gateway FROM ip_pools WHERE workspace_id = ? AND device_id = ? AND profile_name = ?',
            [workspace_id, deviceId, profile]
        );

        if (pools.length === 0) {
            return res.status(404).json({ message: `IP Pool untuk profil "${profile}" belum diatur.` });
        }

        const { ip_start, ip_end, gateway } = pools[0];
        
        let query = 'SELECT remote_address as `remote-address`, current_address as address FROM pppoe_secrets WHERE workspace_id = ?';
        let params = [workspace_id];
        if (deviceId) {
            query += ' AND device_id = ?';
            params.push(deviceId);
        }
        
        const [rows] = await pool.query(query, params);
        
        // Gabungkan IP dari secrets dan active connections
        rows.forEach(r => {
            if (r['remote-address']) activeUsedIpsSet.add(r['remote-address']);
            if (r.address) activeUsedIpsSet.add(r.address);
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
    let workspaceId = req.user.workspace_id;

    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    const { name, password, profile, service = 'pppoe', localAddress, remoteAddress } = req.body;
    if (!name || !password || !profile) {
        return res.status(400).json({ message: 'Nama, password, dan profile wajib diisi.' });
    }

    const requestId = Math.random().toString(36).substring(7);
    console.log(`[Add Secret][${requestId}] Request baru untuk "${name}" (Profile: ${profile})`);

    try {
        const targetDeviceId = req.query.deviceId ? parseInt(req.query.deviceId) : (req.body.deviceId ? parseInt(req.body.deviceId) : null);

        // Proactive check removed to ensure real router verification.

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
        await runCommandForWorkspace(workspaceId, '/ppp/secret/add', params, targetDeviceId);
        // 2. Langsung perbarui cache (Manually) agar UI bisa update seketika
        mikrotikStore.updateSecret(workspaceId, targetDeviceId, 'add', {
            name,
            password,
            profile,
            'remote-address': remoteAddress || null,
            disabled: 'false',
            isActive: false,
            uptime: '0s',
            deviceId: targetDeviceId
        });

        // 3. Broadcast ke UI seketika
        broadcast.broadcastSinglePppoeUpdate(workspaceId, targetDeviceId, name);

        // 4. Trigger refresh latar belakang (Optimized) untuk polling rincian asli
        refreshSecretsNow(workspaceId, targetDeviceId);
        
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
            const checkSecret = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [
                '.proplist=.id,name',
                `?name=${name}`
            ], targetDeviceId, { noRetry: true, timeout: 10000 });

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
        // Dukung workspaceId override dari query param untuk pemanggilan cross-workspace (dari halaman NOC)
        const targetWorkspaceId = req.query.workspaceId ? parseInt(req.query.workspaceId) : req.user.workspace_id;
        // Ambil deviceId dari query param agar profile diambil dari device yang benar
        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

        let profileNames = [];

        // Coba ambil dari router dengan timeout pendek (10 detik)
        try {
            const profiles = await runCommandForWorkspace(
                targetWorkspaceId, 
                '/ppp/profile/print', 
                ['.proplist=name'], 
                deviceId,
                { timeout: 10000, noRetry: true } // Timeout pendek, tanpa retry
            );
            profileNames = profiles.map(p => p.name).filter(Boolean);
        } catch (routerError) {
            // Jika router tidak bisa diakses, fallback ke daftar profile unik dari database
            console.warn(`[Profiles] Gagal dari router (${routerError.message}), fallback ke database...`);
            try {
                let dbQuery = 'SELECT DISTINCT profile FROM pppoe_secrets WHERE workspace_id = ? AND profile IS NOT NULL AND profile != ""';
                let dbParams = [targetWorkspaceId];
                if (deviceId) {
                    dbQuery += ' AND device_id = ?';
                    dbParams.push(deviceId);
                }
                const [rows] = await pool.query(dbQuery, dbParams);
                profileNames = rows.map(r => r.profile).filter(Boolean);
            } catch (dbError) {
                console.error(`[Profiles] Fallback database juga gagal:`, dbError.message);
                profileNames = []; // Return kosong, bukan 500
            }
        }

        // Sort dan return
        profileNames = [...new Set(profileNames)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        res.json(profileNames);
    } catch (error) {
        // Jangan pernah crash 500 untuk endpoint ini
        console.error('[Profiles] Unexpected error:', error.message);
        res.json([]); // Return array kosong daripada 500
    }
};

exports.setSecretStatus = async (req, res) => {
    const { id } = req.params;
    const { disabled } = req.body;
    let workspaceId = req.user.workspace_id;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    try {
        const realId = await resolveSecretId(workspaceId, id, deviceId);
        await runCommandForWorkspace(workspaceId, '/ppp/secret/set', [`=.id=${realId}`, `=disabled=${disabled}`], deviceId);
        
        // Optimasi: Update cache global & DB segera agar UI update instan
        const isDisabled = disabled === 'true' || disabled === 'yes';
        mikrotikStore.updateSecret(workspaceId, deviceId, 'change', { 
            name: id.startsWith('*') ? null : id, 
            '.id': realId,
            disabled: disabled 
        });

        let dbQuery = 'UPDATE pppoe_secrets SET disabled = ? WHERE workspace_id = ? AND name = ?';
        let dbParams = [isDisabled ? 1 : 0, workspaceId, id];
        if (deviceId) {
            dbQuery += ' AND device_id = ?';
            dbParams.push(deviceId);
        }
        await pool.query(dbQuery, dbParams).catch(e => console.error('[DB Cache Update] Failed:', e.message));

        // Trigger refresh agar UI langsung update
        refreshSecretsNow(workspaceId, deviceId);
        broadcast.broadcastSinglePppoeUpdate(workspaceId, deviceId, id.startsWith('*') ? null : id); // Jika id adalah nama, bisa langsung
        
        res.status(200).json({ message: `Secret berhasil di-${isDisabled ? 'disable' : 'enable'}.` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

exports.kickActiveUser = async (req, res) => {
    const { id } = req.params;
    let workspaceId = req.user.workspace_id;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    try {
        await runCommandForWorkspace(workspaceId, '/ppp/active/remove', [`=.id=${id}`], deviceId);
        
        // Trigger refresh agar UI langsung update
        refreshSecretsNow(workspaceId, deviceId);
        // Note: we don't have the pppoe name here easily unless we fetch it, 
        // but the listener in server.js will handle the active removal anyway.
        
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
    const { name, password, profile, deviceId: bodyDeviceId } = req.body;
    let workspace_id = req.user.workspace_id;
    const deviceId = req.query.deviceId || bodyDeviceId || null;

    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspace_id = parseInt(req.query.workspaceId);
    }
    if (!profile) {
        return res.status(400).json({ message: 'Profil wajib diisi.' });
    }
    try {
        // Resolve .id and oldName
        const oldSecretData = await runCommandForWorkspace(workspace_id, '/ppp/secret/print', [id.startsWith('*') ? `?=.id=${id}` : `?name=${id}`], deviceId);
        let oldName = null;
        let realId = id;
        if (oldSecretData && oldSecretData.length > 0) {
            oldName = oldSecretData[0].name;
            realId = oldSecretData[0]['.id'];
        } else {
             return res.status(404).json({ message: 'Secret tidak ditemukan di router' });
        }

        const params = [`=.id=${realId}`, `=profile=${profile}`];
        if (name) {
            params.push(`=name=${name}`);
        }
        if (password) {
            params.push(`=password=${password}`);
        }
        await runCommandForWorkspace(workspace_id, '/ppp/secret/set', params, deviceId);
        
        // 2. Update cache lokal (mikrotikStore) agar UI update instan
        mikrotikStore.updateSecret(workspace_id, deviceId, 'change', {
            '.id': realId,
            name: name || oldName,
            profile: profile,
            password: password || undefined
        });

        // 3. Trigger refresh agar UI langsung update
        refreshSecretsNow(workspace_id, deviceId);
        broadcast.broadcastSinglePppoeUpdate(workspace_id, deviceId, name || oldName || id);
        
        // Update database references if name changed
        if (name && oldName && name !== oldName) {
            try {
                // Update map clients
                await pool.query('UPDATE clients SET pppoe_secret_name = ? WHERE pppoe_secret_name = ? AND workspace_id = ?', [name, oldName, workspace_id]);
                // Update odp connections
                await pool.query('UPDATE odp_user_connections SET pppoe_secret_name = ? WHERE pppoe_secret_name = ? AND workspace_id = ?', [name, oldName, workspace_id]);
                // Update logs
                await pool.query('UPDATE pppoe_usage_logs SET pppoe_user = ? WHERE pppoe_user = ? AND workspace_id = ?', [name, oldName, workspace_id]);
            } catch (dbErr) {
                console.error(`[Update Secret DB] Failed to cascade name update from ${oldName} to ${name}:`, dbErr);
            }
        }

        res.status(200).json({ message: 'Secret berhasil diperbarui.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteSecret = async (req, res) => {
    const { id } = req.params;
    let workspace_id = req.user.workspace_id;
    
    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspace_id = parseInt(req.query.workspaceId);
    }

    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
    
    try {
        console.log(`[Delete Secret] [STEP 1] Memulai proses hapus untuk ID/Name: ${id} | Workspace: ${workspace_id} | Device: ${deviceId}`);

        // 1. Dapatkan data secret dari Mikrotik untuk memastikan ID-nya benar
        let secretName = null;
        let mikrotikId = null;

        try {
            console.log(`[Delete Secret] [STEP 2] Mencari secret "${id}" di router...`);
            // Gunakan timeout yang lebih pendek untuk pengecekan (30 detik) agar tidak menggantung terlalu lama
            const secretData = await runCommandForWorkspace(workspace_id, '/ppp/secret/print', 
                [id.startsWith('*') ? `?=.id=${id}` : `?name=${id}`], 
                deviceId,
                { timeout: 30000 }
            );

            if (secretData && secretData.length > 0) {
                secretName = secretData[0].name;
                mikrotikId = secretData[0]['.id'];
                console.log(`[Delete Secret] Menemukan secret di router: ${secretName} (${mikrotikId})`);
            } else {
                console.warn(`[Delete Secret] Secret "${id}" tidak ditemukan di router Mikrotik.`);
                
                // Fallback: Cari nama asli dari database jika id yang dikirim adalah Mikrotik ID (*1, dsb)
                if (id.startsWith('*')) {
                    const [dbSecret] = await pool.query(
                        'SELECT name FROM pppoe_secrets WHERE workspace_id = ? AND device_id = ? AND (name = ? OR `active_connection_id` = ?)',
                        [workspace_id, deviceId, id, id]
                    );
                    if (dbSecret.length > 0) {
                        secretName = dbSecret[0].name;
                        console.log(`[Delete Secret] Resolve nama dari DB: ${secretName}`);
                    }
                } else {
                    secretName = id;
                }
            }
        } catch (error) {
            console.warn(`[Delete Secret] [WARN] Gagal cek status router (Router mungkin offline): ${error.message}`);
            // Tetap set secretName agar proses DB bisa lanjut jika id bukan Mikrotik ID
            if (!id.startsWith('*')) {
                secretName = id;
            }
        }

        // 2. Hapus secret dari router Mikrotik (Hanya jika ID ditemukan)
        if (mikrotikId) {
            try {
                console.log(`[Delete Secret] [STEP 3] Menghapus secret dari Mikrotik (ID: ${mikrotikId})...`);
                await runCommandForWorkspace(workspace_id, '/ppp/secret/remove', [`=.id=${mikrotikId}`], deviceId);
                console.log(`[Delete Secret] Berhasil menghapus dari Mikrotik.`);
            } catch (e) {
                console.error(`[Delete Secret] [ERROR] Gagal menghapus dari Mikrotik: ${e.message}`);
                // Kita tidak throw error di sini agar database tetap bisa dibersihkan
            }
        }

        // 3. Bersihkan data di Database MySQL jika nama secret diketahui
        if (secretName) {
            console.log(`[Delete Secret] [STEP 4] Membersihkan database untuk secret name: ${secretName}`);
            
            // A. Hapus foto rumah jika ada
            try {
                const [clientPhoto] = await pool.query(
                    'SELECT photo_url FROM clients WHERE pppoe_secret_name = ? AND workspace_id = ?', 
                    [secretName, workspace_id]
                );
                
                if (clientPhoto.length > 0 && clientPhoto[0].photo_url) {
                    const photoPath = path.join(__dirname, '../../', clientPhoto[0].photo_url);
                    if (fs.existsSync(photoPath)) {
                        fs.unlinkSync(photoPath);
                        console.log(`[Delete Secret] Foto berhasil dihapus: ${photoPath}`);
                    }
                }
            } catch (photoErr) {
                console.warn(`[Delete Secret] Gagal menghapus foto: ${photoErr.message}`);
            }

            // B. Hapus hubungan line dengan ODP
            await pool.query(
                'DELETE FROM odp_user_connections WHERE workspace_id = ? AND pppoe_secret_name = ?',
                [workspace_id, secretName]
            );

            // C. Hapus koordinat client dari peta
            const [result] = await pool.query(
                'DELETE FROM clients WHERE pppoe_secret_name = ? AND workspace_id = ?',
                [secretName, workspace_id]
            );

            if (result.affectedRows > 0) {
                console.log(`[Delete Secret] Data client map "${secretName}" berhasil dihapus dari database.`);
            }
            
            // D. Broadcast penghapusan ke WebSocket agar UI terupdate real-time
            mikrotikStore.markPendingDelete(workspace_id, deviceId, secretName);
            broadcast.broadcastSinglePppoeRemove(workspace_id, deviceId, secretName);
        }
        
        // Trigger background refresh agar cache mikrotikStoreSinkron
        refreshSecretsNow(workspace_id, deviceId);
        
        console.log(`[Delete Secret] [STEP 5] Proses selesai untuk user: ${secretName || id}`);
        res.status(200).json({ 
            success: true,
            message: 'Secret berhasil dihapus (Mikrotik & Database).',
            router_synced: !!mikrotikId
        });
    } catch (error) {
        console.error(`[Delete Secret] [CRITICAL ERROR] Gagal total hapus id ${id}: ${error.message}`);
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

exports.isolateSecret = async (req, res) => {
    const { id } = req.params;
    let workspaceId = req.user.workspace_id;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    console.log(`[Isolate Secret] Request for: ${id}, workspace: ${workspaceId}, device: ${deviceId}`);

    console.log(`[Isolate Secret] Step 1: Getting secret data for: ${id}`);
    try {
        // 1. Ambil data secret saat ini
        const secretData = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [id.startsWith('*') ? `?=.id=${id}` : `?name=${id}`], deviceId);
        if (!secretData || secretData.length === 0) {
            console.error(`[Isolate Secret] Secret ${id} not found`);
            return res.status(404).json({ message: 'Secret tidak ditemukan di router' });
        }

        const currentProfile = secretData[0].profile;
        const secretName = secretData[0].name;
        const realId = secretData[0]['.id'];

        if (currentProfile === 'Isolir') {
            return res.status(400).json({ message: 'User sudah dalam status Isolir.' });
        }

        console.log(`[Isolate Secret] Step 2: Attempting to set profile to Isolir for ${secretName}`);
        // 2. Langsung coba ubah profil ke Isolir. Jika gagal karena profil tidak ada, tangkap error-nya.
        try {
            await runCommandForWorkspace(workspaceId, '/ppp/secret/set', [`=.id=${realId}`, '=profile=Isolir'], deviceId);
        } catch (setErr) {
            console.error(`[Isolate Secret] Set profile failed: ${setErr.message}`);
            if (setErr.message?.toLowerCase().includes('profile')) {
                return res.status(404).json({ 
                    message: 'Profil "Isolir" tidak tersedia di MikroTik. Silakan buat profil dengan nama "Isolir" terlebih dahulu di router Anda.' 
                });
            }
            throw setErr;
        }

        console.log(`[Isolate Secret] Step 3: Saving previous_profile: ${currentProfile} to DB`);
        // 3. Simpan profil lama dan UPDATE profil baru ke database (fast-path cache)
        let updateQuery = 'UPDATE pppoe_secrets SET profile = "Isolir", previous_profile = ? WHERE workspace_id = ? AND name = ?';
        let updateParams = [currentProfile, workspaceId, secretName];
        if (deviceId) {
            updateQuery += ' AND device_id = ?';
            updateParams.push(deviceId);
        }
        await pool.query(updateQuery, updateParams);

        console.log(`[Isolate Secret] Step 4: Kicking user ${secretName} to apply changes`);
        // 4. Kick user jika sedang aktif agar profil baru (Isolir) segera diterapkan
        const activeData = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [`?name=${secretName}`], deviceId);
        if (activeData && activeData.length > 0) {
            for (const active of activeData) {
                await runCommandForWorkspace(workspaceId, '/ppp/active/remove', [`=.id=${active['.id']}`], deviceId);
            }
            // Update DB cache segera agar status "OFFLINE" langsung broadcast
            await pool.query('UPDATE pppoe_secrets SET is_active = 0, active_connection_id = NULL WHERE workspace_id = ? AND name = ?', [workspaceId, secretName]).catch(() => {});
        }

        // 5. Update cache lokal (mikrotikStore) agar UI update instan
        mikrotikStore.updateSecret(workspaceId, deviceId, 'change', {
            name: secretName,
            profile: 'Isolir',
            isActive: false // Karena di-kick
        });

        refreshSecretsNow(workspaceId, deviceId);
        broadcast.broadcastSinglePppoeUpdate(workspaceId, deviceId, secretName);
        console.log(`[Isolate Secret] Success for ${secretName}`);
        res.status(200).json({ message: `User ${secretName} berhasil di-Isolir.` });
    } catch (error) {
        console.error('[Isolate Secret] Error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.unisolateSecret = async (req, res) => {
    const { id } = req.params;
    let workspaceId = req.user.workspace_id;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

    // Support override for NOC / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    console.log(`[Unisolate Secret] Request for: ${id}, workspace: ${workspaceId}, device: ${deviceId}`);

    try {
        // 1. Ambil data secret dari MikroTik
        const secretData = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [id.startsWith('*') ? `?=.id=${id}` : `?name=${id}`], deviceId);
        if (!secretData || secretData.length === 0) {
            return res.status(404).json({ message: 'Secret tidak ditemukan di router' });
        }

        const secretName = secretData[0].name;
        const realId = secretData[0]['.id'];

        // 2. Ambil previous_profile dari database
        let selectQuery = 'SELECT previous_profile FROM pppoe_secrets WHERE workspace_id = ? AND name = ?';
        let selectParams = [workspaceId, secretName];
        if (deviceId) {
            selectQuery += ' AND device_id = ?';
            selectParams.push(deviceId);
        }

        const [rows] = await pool.query(selectQuery, selectParams);

        let targetProfile = 'default'; // Fallback
        if (rows.length > 0 && rows[0].previous_profile) {
            targetProfile = rows[0].previous_profile;
        }

        console.log(`[Unisolate Secret] Found previous_profile: ${targetProfile} for ${secretName}`);

        // 3. Kembalikan profil di MikroTik
        await runCommandForWorkspace(workspaceId, '/ppp/secret/set', [`=.id=${realId}`, `=profile=${targetProfile}`], deviceId);

        // 4. Bersihkan previous_profile dan UPDATE profil ke database (fast-path cache)
        let clearQuery = 'UPDATE pppoe_secrets SET profile = ?, previous_profile = NULL WHERE workspace_id = ? AND name = ?';
        let clearParams = [targetProfile, workspaceId, secretName];
        if (deviceId) {
            clearQuery += ' AND device_id = ?';
            clearParams.push(deviceId);
        }
        await pool.query(clearQuery, clearParams);

        // 5. Kick user jika sedang aktif agar profil lama segera diterapkan
        const activeData = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [`?name=${secretName}`], deviceId);
        if (activeData && activeData.length > 0) {
            for (const active of activeData) {
                await runCommandForWorkspace(workspaceId, '/ppp/active/remove', [`=.id=${active['.id']}`], deviceId);
            }
            // Update DB cache segera agar status "OFFLINE" langsung broadcast
            await pool.query('UPDATE pppoe_secrets SET is_active = 0, active_connection_id = NULL WHERE workspace_id = ? AND name = ?', [workspaceId, secretName]).catch(() => {});
        }

        // 6. Update cache lokal (mikrotikStore) agar UI update instan
        mikrotikStore.updateSecret(workspaceId, deviceId, 'change', {
            name: secretName,
            profile: targetProfile,
            isActive: false // Karena di-kick
        });

        // Trigger refresh agar UI langsung update
        refreshSecretsNow(workspaceId, deviceId);
        broadcast.broadcastSinglePppoeUpdate(workspaceId, deviceId, secretName);

        res.status(200).json({ message: `Isolir user ${secretName} berhasil dibuka. Profil dikembalikan ke: ${targetProfile}` });
    } catch (error) {
        console.error('[Unisolate Secret] Error:', error.message);
        res.status(500).json({ message: error.message });
    }
};