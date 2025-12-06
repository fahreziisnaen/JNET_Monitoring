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

exports.setMainInterface = async (req, res) => {
    const { interfaceName } = req.body;
    const workspaceId = req.user.workspace_id;
    if (!interfaceName) {
        return res.status(400).json({ message: 'Nama interface tidak boleh kosong.' });
    }
    try {
        await pool.query('UPDATE workspaces SET main_interface = ? WHERE id = ?', [interfaceName, workspaceId]);
        res.status(200).json({ message: 'Interface utama berhasil disimpan.' });
    } catch (error) {
        console.error("SET MAIN INTERFACE ERROR:", error);
        res.status(500).json({ message: 'Gagal menyimpan interface utama.' });
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