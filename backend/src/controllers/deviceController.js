const pool = require('../config/database');
const mikrotikStore = require('../utils/mikrotikStore');
const backgroundMonitor = require('../bot/backgroundMonitor');

exports.listDevices = async (req, res) => {
    const user = req.user;
    let workspaceId = user.workspace_id;
    
    // Dukungan override workspaceId untuk NOC / Admin (hanya satu workspace)
    if (req.query.workspaceId && (user.role === 'admin' || user.role === 'noc')) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    try {
        if (user.is_super_admin) {
            // Jika Superadmin minta workspace spesifik, filter berdasarkan itu.
            // Jika tidak, baru tampilkan SEMUA.
            if (req.query.workspaceId) {
                const targetWsId = parseInt(req.query.workspaceId);
                const [devices] = await pool.query(`
                    SELECT d.id, d.name, d.host, d.user, d.port, d.workspace_id, w.name as workspace_name 
                    FROM mikrotik_devices d
                    JOIN workspaces w ON d.workspace_id = w.id
                    WHERE d.workspace_id = ?
                `, [targetWsId]);
                return res.status(200).json(devices);
            }

            // Default Superadmin: Tampilkan SEMUA
            const [devices] = await pool.query(`
                SELECT d.id, d.name, d.host, d.user, d.port, d.workspace_id, w.name as workspace_name 
                FROM mikrotik_devices d
                JOIN workspaces w ON d.workspace_id = w.id
            `);
            return res.status(200).json(devices);
        }

        if (user.role === 'noc' && !req.query.workspaceId) {
            // Jika NOC dan tidak minta workspace spesifik, tampilkan SEMUA yang diizinkan
            const [permWorkspaces] = await pool.query(
                'SELECT workspace_id FROM noc_permissions WHERE user_id = ?',
                [user.id]
            );
            const authorizedIds = [user.workspace_id, ...permWorkspaces.map(p => p.workspace_id)];
            
            // Ambil detail device beserta nama workspacenya agar mudah dibedakan di UI
            const [devices] = await pool.query(`
                SELECT d.id, d.name, d.host, d.user, d.port, d.workspace_id, w.name as workspace_name 
                FROM mikrotik_devices d
                JOIN workspaces w ON d.workspace_id = w.id
                WHERE d.workspace_id IN (?)
            `, [authorizedIds]);
            
            return res.status(200).json(devices);
        }

        if (!workspaceId) return res.json([]);

        // Default: Ambil device untuk satu workspace tertentu
        const [devices] = await pool.query(`
            SELECT d.id, d.name, d.host, d.user, d.port, d.workspace_id, w.name as workspace_name
            FROM mikrotik_devices d
            JOIN workspaces w ON d.workspace_id = w.id
            WHERE d.workspace_id = ?
        `, [workspaceId]);
        
        res.status(200).json(devices);
    } catch (error) {
        console.error('[Device Controller] Error listDevices:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar perangkat.' });
    }
};

exports.addDevice = async (req, res) => {
    let workspaceId = req.user?.workspace_id;
    
    // Jika workspace_id tidak ada, middleware seharusnya sudah membuat workspace
    // Tapi kita cek lagi untuk memastikan
    if (!workspaceId) {
        console.warn(`[Device Controller] User ${req.user?.id} tidak punya workspace_id, mencoba membuat workspace...`);
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: 'Tidak terotorisasi.' });
            }
            
            // Query user untuk mendapatkan display_name atau username
            const [users] = await pool.query('SELECT display_name, username FROM users WHERE id = ?', [userId]);
            if (users.length === 0) {
                return res.status(401).json({ message: 'User tidak ditemukan.' });
            }
            
            const userData = users[0];
            const [wsResult] = await pool.query(
                'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
                [`${userData.display_name || userData.username}'s Workspace`, userId]
            );
            await pool.query('UPDATE users SET workspace_id = ? WHERE id = ?', [wsResult.insertId, userId]);
            workspaceId = wsResult.insertId;
            console.log(`[Device Controller] Workspace ${workspaceId} berhasil dibuat untuk user ${userId}`);
        } catch (error) {
            console.error('[Device Controller] Error membuat workspace:', error);
            return res.status(500).json({ message: 'Gagal membuat workspace. Silakan login ulang.' });
        }
    }
    
    const { name, host, user, password, port } = req.body;
    if (!name || !host || !user || !port) return res.status(400).json({ message: 'Nama, Host, User, dan Port wajib diisi.' });
    
    try {
        const [result] = await pool.query('INSERT INTO mikrotik_devices (workspace_id, name, host, user, password, port) VALUES (?, ?, ?, ?, ?, ?)', [workspaceId, name, host, user, password || null, port]);
        const [devices] = await pool.query('SELECT id FROM mikrotik_devices WHERE workspace_id = ?', [workspaceId]);
        if (devices.length === 1) {
            await pool.query('UPDATE workspaces SET active_device_id = ? WHERE id = ?', [result.insertId, workspaceId]);
        }
        res.status(201).json({ message: 'Perangkat berhasil ditambahkan.', deviceId: result.insertId });
    } catch (error) {
        console.error('[Device Controller] Error adding device:', error);
        res.status(500).json({ message: 'Gagal menambah perangkat.', error: error.message });
    }
};

exports.updateDevice = async (req, res) => {
    const { id } = req.params;
    let workspaceId = req.user.workspace_id;
    
    // Dukungan override workspaceId untuk NOC
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc')) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    const { name, host, user, password, port } = req.body;
    if (!name || !host || !user || !port) return res.status(400).json({ message: 'Semua field wajib diisi.' });
    try {
        // Ambil data host lama untuk deteksi pergantian perangkat
        const [currentDevice] = await pool.query(
            'SELECT host FROM mikrotik_devices WHERE id = ? AND workspace_id = ?',
            [id, workspaceId]
        );

        if (currentDevice.length > 0 && (
            currentDevice[0].host !== host || 
            currentDevice[0].port !== parseInt(port) || 
            currentDevice[0].user !== user || 
            (password && currentDevice[0].password !== password)
        )) {
            console.error(`[Device Update] Kredensial berubah untuk ${host}. Membersihkan data lama (DB + Memori)...`);
            
            // 1. Bersihkan database
            await Promise.all([
                pool.query('DELETE FROM pppoe_secrets WHERE workspace_id = ? AND device_id = ?', [workspaceId, id]),
                pool.query('DELETE FROM dashboard_snapshot WHERE workspace_id = ? AND device_id = ?', [workspaceId, id]),
                pool.query('DELETE FROM interface_traffic_logs WHERE workspace_id = ? AND device_id = ?', [workspaceId, id]),
                pool.query('DELETE FROM pppoe_user_status WHERE workspace_id = ? AND device_id = ?', [workspaceId, id])
            ]);

            // 2. Bersihkan in-memory store
            mikrotikStore.clear(workspaceId, id);

            // 3. Restart background monitor agar state internal ikut fresh
            backgroundMonitor.restartDeviceMonitor(workspaceId, id).catch(err => {
                console.error(`[Device Update] Gagal me-restart monitor untuk device ${id}:`, err.message);
            });
        }

        let query, params;
        if (password && password.length > 0) {
            query = 'UPDATE mikrotik_devices SET name = ?, host = ?, user = ?, port = ?, password = ? WHERE id = ? AND workspace_id = ?';
            params = [name, host, user, port, password, id, workspaceId];
        } else {
            query = 'UPDATE mikrotik_devices SET name = ?, host = ?, user = ?, port = ? WHERE id = ? AND workspace_id = ?';
            params = [name, host, user, port, id, workspaceId];
        }
        const [result] = await pool.query(query, params);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Perangkat tidak ditemukan atau Anda tidak punya izin.' });
        res.status(200).json({ message: 'Perangkat berhasil diperbarui.' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memperbarui perangkat.', error: error.message });
    }
};

// Data turunan perangkat. Tabel state kecil dihapus langsung; tabel log bisa berisi puluhan juta baris
// (trafik dicatat per interface + per user PPPoE tiap menit, disimpan 3 bulan) sehingga dihapus bertahap.
const DEVICE_STATE_TABLES = ['dashboard_snapshot', 'pppoe_user_status', 'pppoe_secrets', 'ip_pools'];
const DEVICE_LOG_TABLES = ['downtime_events', 'resource_logs', 'pppoe_usage_logs', 'interface_traffic_logs'];
const PURGE_BATCH_SIZE = 10000;

async function purgeDeviceLogs(workspaceId, deviceId) {
    const startedAt = Date.now();
    for (const table of DEVICE_LOG_TABLES) {
        let total = 0;
        try {
            for (;;) {
                const [r] = await pool.query(
                    `DELETE FROM ${table} WHERE workspace_id = ? AND device_id = ? LIMIT ${PURGE_BATCH_SIZE}`,
                    [workspaceId, deviceId]
                );
                total += r.affectedRows;
                if (r.affectedRows < PURGE_BATCH_SIZE) break;
                // Beri jeda agar query monitor lain tidak tertahan lock
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (err) {
            console.error(`[Device Controller] Gagal membersihkan ${table} untuk device ${deviceId}: ${err.message}`);
        }
        console.log(`[Device Controller] Device ${deviceId}: ${total} baris ${table} dihapus`);
    }
    console.log(`[Device Controller] Pembersihan log device ${deviceId} selesai dalam ${Math.round((Date.now() - startedAt) / 1000)} detik`);
}

exports.deleteDevice = async (req, res) => {
    const deviceId = parseInt(req.params.id, 10);
    let workspaceId = req.user.workspace_id;

    // Dukungan override workspaceId untuk NOC
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc')) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    try {
        const [devices] = await pool.query('SELECT id FROM mikrotik_devices WHERE id = ? AND workspace_id = ?', [deviceId, workspaceId]);
        if (devices.length === 0) {
            const [owner] = await pool.query('SELECT workspace_id FROM mikrotik_devices WHERE id = ?', [deviceId]);
            console.warn(`[Device Controller] deleteDevice id=${deviceId} gagal: user ${req.user.id} (role=${req.user.role}, super_admin=${req.user.is_super_admin}) di workspace ${workspaceId}, perangkat milik workspace ${owner[0]?.workspace_id ?? 'TIDAK ADA'}`);
            return res.status(404).json({ message: 'Perangkat tidak ditemukan atau Anda tidak punya izin.' });
        }

        // Hentikan monitor dulu agar tidak ada log baru yang ditulis untuk perangkat ini
        backgroundMonitor.stopDeviceMonitor(workspaceId, deviceId);
        mikrotikStore.clear(workspaceId, deviceId);

        for (const table of DEVICE_STATE_TABLES) {
            await pool.query(`DELETE FROM ${table} WHERE workspace_id = ? AND device_id = ?`, [workspaceId, deviceId]);
        }
        await pool.query('UPDATE workspaces SET active_device_id = NULL WHERE id = ? AND active_device_id = ?', [workspaceId, deviceId]);

        // Hapus baris perangkat tanpa ON DELETE CASCADE ke tabel log. Cascade jutaan baris dalam satu
        // transaksi membuat request menggantung berlama-lama dan mengunci tabel log; log dibersihkan bertahap di bawah.
        const conn = await pool.getConnection();
        try {
            await conn.query('SET foreign_key_checks = 0');
            await conn.query('DELETE FROM mikrotik_devices WHERE id = ? AND workspace_id = ?', [deviceId, workspaceId]);
        } finally {
            try {
                await conn.query('SET foreign_key_checks = 1');
                conn.release();
            } catch (resetError) {
                // Jangan kembalikan koneksi dengan foreign_key_checks mati ke pool
                conn.destroy();
            }
        }

        res.status(200).json({ message: 'Perangkat berhasil dihapus.' });

        purgeDeviceLogs(workspaceId, deviceId).catch(err => {
            console.error(`[Device Controller] Pembersihan log device ${deviceId} gagal: ${err.message}`);
        });
    } catch (error) {
        console.error(`[Device Controller] Error deleteDevice id=${deviceId} workspace=${workspaceId}:`, error);
        res.status(500).json({ message: 'Gagal menghapus perangkat.', error: error.message });
    }
};

exports.testConnection = async (req, res) => {
    const RouterOSAPI = require('node-routeros').RouterOSAPI;
    let { host, user, password, port, deviceId } = req.body;
    
    if (!host || !user || !port) {
        return res.status(400).json({ message: 'Host, User, dan Port wajib diisi.' });
    }

    try {
        // Jika deviceId dikirim (mode edit) dan password kosong, ambil password lama dari DB
        if (deviceId && !password) {
            const workspaceId = req.user?.workspace_id;
            if (workspaceId) {
                const [rows] = await pool.query('SELECT password FROM mikrotik_devices WHERE id = ? AND workspace_id = ?', [deviceId, workspaceId]);
                if (rows.length > 0 && rows[0].password) {
                    password = rows[0].password;
                }
            }
        }

        const client = new RouterOSAPI({
            host: host,
            user: user,
            password: password || '',
            port: parseInt(port, 10),
            timeout: 10000 // 10 detik batas tes
        });

        await client.connect();
        client.close(); // Tutup setelah sukses
        
        res.status(200).json({ message: 'Koneksi Sukses! MikroTik merespons dengan baik.' });
    } catch (error) {
        console.error('[Device Controller] Test connection failed:', error.message);
        let errorMsg = error.message;
        if (error.message.includes('time') || error.message.includes('ETIMEDOUT')) {
            errorMsg = 'Timeout: IP/Port salah, atau port API di router tertutup.';
        } else if (error.message.includes('invalid') || error.message.includes('login') || error.message.includes('authentication')) {
            errorMsg = 'Username atau password salah.';
        } else if (error.message.includes('ECONNREFUSED')) {
            errorMsg = 'Koneksi ditolak (port salah atau diblokir firewall).';
        } else if (error.message.includes('EHOSTUNREACH')) {
            errorMsg = 'Host Unreachable: IP tidak dapat dijangkau dari server ini.';
        }
        res.status(400).json({ message: errorMsg });
    }
};

exports.getTrafficHistory = async (req, res) => {
    const { id } = req.params;
    const { interface: interfaceName, hours = 24 } = req.query;
    let workspaceId = req.user.workspace_id;

    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    if (!interfaceName) {
        return res.status(400).json({ message: 'Parameter interface wajib diisi.' });
    }

    try {
        const query = `
            SELECT interface_name, tx_bps, rx_bps, timestamp
            FROM interface_traffic_logs
            WHERE workspace_id = ? AND device_id = ? AND interface_name = ?
            AND timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
            ORDER BY timestamp ASC
        `;
        
        const [rows] = await pool.query(query, [workspaceId, id, interfaceName, parseInt(hours)]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('[Device Controller] Error fetching traffic history:', error.message);
        res.status(500).json({ message: 'Gagal mengambil riwayat traffic.' });
    }
};