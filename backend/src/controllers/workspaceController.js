const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');

exports.setActiveDevice = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ message: 'Device ID tidak boleh kosong.' });
    }

    try {
        await pool.query('UPDATE workspaces SET active_device_id = ? WHERE id = ?', [deviceId, workspaceId]);
        res.status(200).json({ message: 'Perangkat aktif berhasil diubah.' });
    } catch (error) {
        console.error("SET ACTIVE DEVICE ERROR:", error);
        res.status(500).json({ message: 'Gagal mengubah perangkat aktif', error: error.message });
    }
};

exports.getWorkspace = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    if (!workspaceId) {
        return res.status(404).json({ message: 'Workspace tidak ditemukan.' });
    }
    try {
        const [workspaces] = await pool.query('SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
        if (workspaces.length === 0) {
            return res.status(404).json({ message: 'Detail workspace tidak ditemukan.' });
        }
        res.json(workspaces[0]);
    } catch (error) {
        console.error("GET WORKSPACE ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil data workspace.' });
    }
};

exports.getAvailableInterfaces = async (req, res) => {
    try {
        const interfaces = await runCommandForWorkspace(req.user.workspace_id, '/interface/print');
        const interfaceNames = interfaces.map(iface => iface.name);
        res.status(200).json(interfaceNames);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil daftar interface dari perangkat.' });
    }
};

exports.getInterfacesByDevice = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { deviceId } = req.query;

    if (!deviceId) {
        return res.status(400).json({ message: 'Device ID harus diisi.' });
    }

    try {
        // Verify device belongs to workspace
        const [devices] = await pool.query(
            'SELECT id, name FROM mikrotik_devices WHERE id = ? AND workspace_id = ?',
            [deviceId, workspaceId]
        );

        if (devices.length === 0) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        // Get interfaces from the device
        const { runCommandForWorkspace } = require('../utils/apiConnection');
        const interfaces = await runCommandForWorkspace(workspaceId, '/interface/print', [], parseInt(deviceId));

        // Filter only running interfaces and exclude PPPoE
        const availableInterfaces = interfaces
            .filter(iface => {
                const running = iface.running === 'true' || iface.running === true || iface.running === 'yes';
                const type = (iface.type || '').toLowerCase();
                return running && !type.includes('pppoe');
            })
            .map(iface => ({
                name: iface.name,
                type: iface.type || 'unknown'
            }));

        res.status(200).json(availableInterfaces);
    } catch (error) {
        console.error("GET INTERFACES BY DEVICE ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar interface dari perangkat.', error: error.message });
    }
};


exports.updateWhatsAppGroupId = async (req, res) => {
    const { whatsapp_group_id } = req.body;
    const workspaceId = req.user.workspace_id;

    // Validasi format WhatsApp Group JID (harus berakhiran @g.us)
    if (whatsapp_group_id && !whatsapp_group_id.endsWith('@g.us')) {
        return res.status(400).json({ message: 'Format WhatsApp Group ID tidak valid. Harus berakhiran @g.us' });
    }

    try {
        await pool.query('UPDATE workspaces SET whatsapp_group_id = ? WHERE id = ?', [whatsapp_group_id || null, workspaceId]);
        res.status(200).json({
            message: whatsapp_group_id ? 'WhatsApp Group ID berhasil disimpan.' : 'WhatsApp Group ID berhasil dihapus.'
        });
    } catch (error) {
        console.error("UPDATE WHATSAPP GROUP ID ERROR:", error);
        res.status(500).json({ message: 'Gagal menyimpan WhatsApp Group ID.' });
    }
};

exports.getMembers = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    try {
        const [members] = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.role, u.profile_picture_url, 
             (w.owner_id = u.id) as is_owner
             FROM users u
             JOIN workspaces w ON u.workspace_id = w.id
             WHERE u.workspace_id = ?`,
            [workspaceId]
        );
        res.status(200).json(members);
    } catch (error) {
        console.error("GET MEMBERS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar anggota.' });
    }
};

exports.removeMember = async (req, res) => {
    const { userId: targetUserId } = req.params;
    const adminUserId = req.user.id;
    const workspaceId = req.user.workspace_id;

    if (parseInt(targetUserId) === adminUserId) {
        return res.status(400).json({ message: 'Anda tidak bisa mengeluarkan diri sendiri.' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Pastikan workspace ada dan ambil owner_id
        const [workspaces] = await conn.query('SELECT owner_id, name FROM workspaces WHERE id = ?', [workspaceId]);
        if (workspaces.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Workspace tidak ditemukan.' });
        }
        const workspace = workspaces[0];

        // 2. Pastikan target user ada di workspace ini
        const [targetUsers] = await conn.query('SELECT id, display_name FROM users WHERE id = ? AND workspace_id = ?', [targetUserId, workspaceId]);
        if (targetUsers.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'User tidak ditemukan di workspace ini.' });
        }
        const targetUser = targetUsers[0];

        // 3. Jangan biarkan kick owner
        if (workspace.owner_id === parseInt(targetUserId)) {
            await conn.rollback();
            return res.status(403).json({ message: 'Pemilik workspace tidak bisa dikeluarkan.' });
        }

        // 4. Buat workspace baru untuk user yang di-kick agar tidak error (homeless)
        const [newWsResult] = await conn.query(
            'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
            [`${targetUser.display_name}'s Private Workspace`, targetUserId]
        );
        const newWorkspaceId = newWsResult.insertId;

        // 5. Update user ke workspace baru dan set jadi admin di sana
        await conn.query(
            'UPDATE users SET workspace_id = ?, role = "admin" WHERE id = ?',
            [newWorkspaceId, targetUserId]
        );

        // 6. Hapus semua session user tersebut agar dia dipaksa login ulang atau refresh state
        await conn.query('DELETE FROM user_sessions WHERE user_id = ?', [targetUserId]);

        await conn.commit();
        res.status(200).json({ message: `Berhasil mengeluarkan ${targetUser.display_name} dari workspace.` });
    } catch (error) {
        await conn.rollback();
        console.error("REMOVE MEMBER ERROR:", error);
        res.status(500).json({ message: 'Gagal mengeluarkan anggota.' });
    } finally {
        conn.release();
    }
};

exports.getAllWorkspaces = async (req, res) => {
    try {
        const [workspaces] = await pool.query(
            'SELECT id, name, whatsapp_group_id, owner_id FROM workspaces ORDER BY name ASC'
        );
        res.json(workspaces);
    } catch (error) {
        console.error("GET ALL WORKSPACES ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil data semua workspace.' });
    }
};

exports.adminUpdateWhatsAppGroupId = async (req, res) => {
    const { workspaceId } = req.params;
    const { whatsapp_group_id } = req.body;

    if (whatsapp_group_id && !whatsapp_group_id.endsWith('@g.us')) {
        return res.status(400).json({ message: 'Format WhatsApp Group ID tidak valid. Harus berakhiran @g.us' });
    }

    try {
        await pool.query('UPDATE workspaces SET whatsapp_group_id = ? WHERE id = ?', [whatsapp_group_id || null, workspaceId]);
        res.status(200).json({ message: 'WhatsApp Group ID berhasil diperbarui oleh Admin.' });
    } catch (error) {
        console.error("ADMIN UPDATE WHATSAPP GROUP ID ERROR:", error);
        res.status(500).json({ message: 'Gagal memperbarui WhatsApp Group ID.' });
    }
};

exports.updateMemberRole = async (req, res) => {
    const { userId: targetUserId } = req.params;
    const { role: newRole } = req.body;
    const currentUser = req.user;

    // Validasi role
    if (!['admin', 'user'].includes(newRole)) {
        return res.status(400).json({ message: 'Role harus "admin" atau "user".' });
    }

    // Tidak bisa ubah role diri sendiri
    if (parseInt(targetUserId) === currentUser.id) {
        return res.status(400).json({ message: 'Anda tidak bisa mengubah role diri sendiri.' });
    }

    try {
        // Super admin bisa ubah role siapapun di workspace manapun
        if (currentUser.is_super_admin) {
            // Pastikan target user ada
            const [targetUsers] = await pool.query(
                'SELECT u.id, u.display_name, u.workspace_id, (w.owner_id = u.id) as is_owner FROM users u LEFT JOIN workspaces w ON u.workspace_id = w.id WHERE u.id = ?',
                [targetUserId]
            );
            if (targetUsers.length === 0) {
                return res.status(404).json({ message: 'User tidak ditemukan.' });
            }

            // Tidak bisa ubah role owner
            if (targetUsers[0].is_owner) {
                return res.status(403).json({ message: 'Role pemilik workspace tidak bisa diubah.' });
            }

            await pool.query('UPDATE users SET role = ? WHERE id = ?', [newRole, targetUserId]);
            return res.status(200).json({
                message: `Role ${targetUsers[0].display_name} berhasil diubah menjadi ${newRole}.`
            });
        }

        // Admin biasa: hanya bisa ubah role anggota di workspace sendiri
        const workspaceId = currentUser.workspace_id;

        const [targetUsers] = await pool.query(
            'SELECT u.id, u.display_name, (w.owner_id = u.id) as is_owner FROM users u JOIN workspaces w ON u.workspace_id = w.id WHERE u.id = ? AND u.workspace_id = ?',
            [targetUserId, workspaceId]
        );

        if (targetUsers.length === 0) {
            return res.status(404).json({ message: 'User tidak ditemukan di workspace ini.' });
        }

        // Tidak bisa ubah role owner
        if (targetUsers[0].is_owner) {
            return res.status(403).json({ message: 'Role pemilik workspace tidak bisa diubah.' });
        }

        await pool.query('UPDATE users SET role = ? WHERE id = ?', [newRole, targetUserId]);
        res.status(200).json({
            message: `Role ${targetUsers[0].display_name} berhasil diubah menjadi ${newRole}.`
        });
    } catch (error) {
        console.error("UPDATE MEMBER ROLE ERROR:", error);
        res.status(500).json({ message: 'Gagal mengubah role anggota.' });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.role, u.profile_picture_url, 
             u.workspace_id, w.name as workspace_name, (w.owner_id = u.id) as is_owner
             FROM users u
             LEFT JOIN workspaces w ON u.workspace_id = w.id
             ORDER BY w.name ASC, u.display_name ASC`
        );
        res.status(200).json(users);
    } catch (error) {
        console.error("GET ALL USERS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar user.' });
    }
};