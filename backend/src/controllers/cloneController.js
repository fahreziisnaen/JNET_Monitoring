const pool = require('../config/database');
const crypto = require('crypto');

exports.generateCode = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    if (!workspaceId) {
        return res.status(400).json({ message: 'Anda harus punya workspace untuk membuat undangan.' });
    }

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    try {
        await pool.query(
            'INSERT INTO workspace_invites (workspace_id, code, expires_at, created_by) VALUES (?, ?, ?, ?)',
            [workspaceId, code, expiresAt, req.user.id]
        );
        res.status(201).json({ code, expiresAt });
    } catch (error) {
        console.error("GENERATE INVITE CODE ERROR:", error);
        res.status(500).json({ message: 'Gagal membuat kode undangan', error: error.message });
    }
};

exports.useCode = async (req, res) => {
    const { code } = req.body;
    const targetUserId = req.user.id;
    const oldWorkspaceId = req.user.workspace_id;

    if (!code) {
        return res.status(400).json({ message: 'Kode tidak boleh kosong.' });
    }

    try {
        const [invites] = await pool.query('SELECT * FROM workspace_invites WHERE code = ? AND expires_at > NOW()', [code]);
        if (invites.length === 0) {
            return res.status(400).json({ message: 'Kode tidak valid atau sudah kedaluwarsa.' });
        }

        const workspaceIdToJoin = invites[0].workspace_id;

        // Jangan join ke workspace yang sama
        if (oldWorkspaceId === workspaceIdToJoin) {
            return res.status(400).json({ message: 'Anda sudah berada di workspace ini.' });
        }

        // Update workspace_id and set role to 'user'
        await pool.query('UPDATE users SET workspace_id = ?, role = ? WHERE id = ?', [workspaceIdToJoin, 'user', targetUserId]);

        await pool.query('DELETE FROM workspace_invites WHERE code = ?', [code]);

        // Cleanup: Hapus workspace lama jika sudah tidak ada anggota lain
        if (oldWorkspaceId) {
            const [remainingMembers] = await pool.query(
                'SELECT COUNT(*) as count FROM users WHERE workspace_id = ?',
                [oldWorkspaceId]
            );

            if (remainingMembers[0].count === 0) {
                // Workspace kosong, hapus. ON DELETE CASCADE di FK akan otomatis
                // menghapus: mikrotik_devices, network_assets, clients, ip_pools,
                // odp_user_connections, downtime_events, pppoe_user_status,
                // workspace_invites, pppoe_usage_logs, resource_logs, alarms,
                // dashboard_snapshot
                await pool.query('DELETE FROM workspaces WHERE id = ?', [oldWorkspaceId]);
                console.log(`[Clone] Workspace lama ${oldWorkspaceId} dihapus (tidak ada anggota tersisa)`);
            }
        }

        res.status(200).json({ message: 'Berhasil bergabung dengan workspace!' });
    } catch (error) {
        console.error("USE INVITE CODE ERROR:", error);
        res.status(500).json({ message: error.message || 'Gagal menggunakan kode.' });
    }
};