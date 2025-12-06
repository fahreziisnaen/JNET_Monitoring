const pool = require('../config/database');

exports.listDevices = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    if (!workspaceId) return res.json([]);
    try {
        const [devices] = await pool.query('SELECT id, name, host, user, port FROM mikrotik_devices WHERE workspace_id = ?', [workspaceId]);
        res.status(200).json(devices);
    } catch (error) {
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
    const workspaceId = req.user.workspace_id;
    const { name, host, user, password, port } = req.body;
    if (!name || !host || !user || !port) return res.status(400).json({ message: 'Semua field wajib diisi.' });
    try {
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

exports.deleteDevice = async (req, res) => {
    const { id } = req.params;
    const workspaceId = req.user.workspace_id;
    try {
        const [result] = await pool.query('DELETE FROM mikrotik_devices WHERE id = ? AND workspace_id = ?', [id, workspaceId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Perangkat tidak ditemukan atau Anda tidak punya izin.' });
        const [workspaces] = await pool.query('SELECT active_device_id FROM workspaces WHERE id = ?', [workspaceId]);
        if (workspaces.length > 0 && workspaces[0].active_device_id === parseInt(id, 10)) {
            await pool.query('UPDATE workspaces SET active_device_id = NULL WHERE id = ?', [workspaceId]);
        }
        res.status(200).json({ message: 'Perangkat berhasil dihapus.' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus perangkat.', error: error.message });
    }
};