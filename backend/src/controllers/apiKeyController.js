const pool = require('../config/database');
const crypto = require('crypto');

// Get all API keys with their workspace names
exports.getAllApiKeys = async (req, res) => {
    try {
        const [apiKeys] = await pool.query(`
            SELECT 
                k.id, 
                k.workspace_id, 
                k.name, 
                k.key_string, 
                k.created_at,
                w.name AS workspace_name
            FROM api_keys k
            LEFT JOIN workspaces w ON k.workspace_id = w.id
            ORDER BY k.created_at DESC
        `);

        return res.status(200).json(apiKeys);
    } catch (error) {
        console.error('Error in getAllApiKeys:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan internal server saat mengambil API Key' });
    }
};

// Create a new API Key for a workspace
exports.createApiKey = async (req, res) => {
    try {
        const { workspace_id, name } = req.body;

        if (!workspace_id || !name) {
            return res.status(400).json({ message: 'Workspace ID dan Nama API Key wajib diisi' });
        }

        // Generate a random 32-character hex key
        const keyString = crypto.randomBytes(16).toString('hex');

        // Check if workspace exists
        const [workspace] = await pool.query('SELECT id FROM workspaces WHERE id = ?', [workspace_id]);
        if (workspace.length === 0) {
            return res.status(404).json({ message: 'Workspace tidak ditemukan' });
        }

        const [result] = await pool.query(
            'INSERT INTO api_keys (workspace_id, name, key_string) VALUES (?, ?, ?)',
            [workspace_id, name, keyString]
        );

        return res.status(201).json({
            message: 'API Key berhasil dibuat',
            apiKey: {
                id: result.insertId,
                workspace_id,
                name,
                key_string: keyString
            }
        });
    } catch (error) {
        console.error('Error in createApiKey:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan saat membuat API Key' });
    }
};

// Delete an API Key
exports.deleteApiKey = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query('DELETE FROM api_keys WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'API Key tidak ditemukan' });
        }

        return res.status(200).json({ message: 'API Key berhasil dihapus' });
    } catch (error) {
        console.error('Error in deleteApiKey:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan saat menghapus API Key' });
    }
};
