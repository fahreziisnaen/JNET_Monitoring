const { sendWhatsAppMessage, getWorkspaceWhatsAppTarget } = require('../services/whatsappService');
const pool = require('../config/database');

exports.sendPppoeDisconnectNotification = async (req, res) => {
    try {
        const workspaceId = req.user.workspace_id;
        const { users, timestamp } = req.body;

        if (!users || !Array.isArray(users) || users.length === 0) {
            return res.status(400).json({ message: 'Users array is required' });
        }

        // Get workspace info dan WhatsApp target (group atau individual)
        const [workspaces] = await pool.query(
            `SELECT w.id, w.name as workspace_name, w.whatsapp_group_id, u.whatsapp_number
             FROM workspaces w
             LEFT JOIN users u ON w.owner_id = u.id
             WHERE w.id = ?`,
            [workspaceId]
        );

        if (workspaces.length === 0) {
            return res.status(404).json({ message: 'Workspace not found' });
        }

        const workspace = workspaces[0];
        const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
        
        if (!whatsappTarget) {
            return res.status(404).json({ message: 'No WhatsApp group or owner number configured for this workspace' });
        }

        const disconnectTime = timestamp ? new Date(timestamp).toLocaleString('id-ID') : new Date().toLocaleString('id-ID');
        
        // Format message
        let message = `🚨 *PPPoE User Disconnected* 🚨\n\n`;
        message += `Workspace: *${workspace.workspace_name}*\n`;
        message += `Waktu: ${disconnectTime}\n\n`;
        
        if (users.length === 1) {
            message += `User yang disconnect:\n`;
            message += `• *${users[0]}*\n\n`;
        } else {
            message += `User yang disconnect (${users.length}):\n`;
            users.forEach((user, index) => {
                message += `${index + 1}. *${user}*\n`;
            });
            message += `\n`;
        }
        
        message += `Silakan periksa kondisi jaringan atau hubungi user terkait.`;

        // Send WhatsApp message ke group atau individual
        await sendWhatsAppMessage(whatsappTarget, message);

        res.status(200).json({ 
            message: 'Notification sent successfully',
            sentTo: whatsappTarget,
            usersCount: users.length
        });
    } catch (error) {
        console.error('[Notification Controller] Error:', error);
        res.status(500).json({ message: 'Failed to send notification', error: error.message });
    }
};

exports.sendPppoeReconnectNotification = async (req, res) => {
    try {
        const workspaceId = req.user.workspace_id;
        const { users, timestamp, durations } = req.body;

        if (!users || !Array.isArray(users) || users.length === 0) {
            return res.status(400).json({ message: 'Users array is required' });
        }

        // Get workspace info dan WhatsApp target (group atau individual)
        const [workspaces] = await pool.query(
            `SELECT w.id, w.name as workspace_name, w.whatsapp_group_id, u.whatsapp_number
             FROM workspaces w
             LEFT JOIN users u ON w.owner_id = u.id
             WHERE w.id = ?`,
            [workspaceId]
        );

        if (workspaces.length === 0) {
            return res.status(404).json({ message: 'Workspace not found' });
        }

        const workspace = workspaces[0];
        const whatsappTarget = await getWorkspaceWhatsAppTarget(workspaceId);
        
        if (!whatsappTarget) {
            return res.status(404).json({ message: 'No WhatsApp group or owner number configured for this workspace' });
        }

        const reconnectTime = timestamp ? new Date(timestamp).toLocaleString('id-ID') : new Date().toLocaleString('id-ID');
        
        // Format message
        let message = `✅ *PPPoE User Reconnected* ✅\n\n`;
        message += `Workspace: *${workspace.workspace_name}*\n`;
        message += `Waktu: ${reconnectTime}\n\n`;
        
        if (users.length === 1) {
            message += `User yang reconnect:\n`;
            message += `• *${users[0]}*\n`;
            if (durations && durations[0]) {
                const durationMinutes = Math.floor(durations[0] / 60);
                const durationSeconds = durations[0] % 60;
                message += `Durasi downtime: ${durationMinutes}m ${durationSeconds}s\n`;
            }
            message += `\n`;
        } else {
            message += `User yang reconnect (${users.length}):\n`;
            users.forEach((user, index) => {
                message += `${index + 1}. *${user}*`;
                if (durations && durations[index]) {
                    const durationMinutes = Math.floor(durations[index] / 60);
                    const durationSeconds = durations[index] % 60;
                    message += ` (${durationMinutes}m ${durationSeconds}s)`;
                }
                message += `\n`;
            });
            message += `\n`;
        }
        
        message += `Koneksi telah pulih. User dapat menggunakan layanan kembali.`;

        // Send WhatsApp message ke group atau individual
        await sendWhatsAppMessage(whatsappTarget, message);

        res.status(200).json({ 
            message: 'Notification sent successfully',
            sentTo: whatsappTarget,
            usersCount: users.length
        });
    } catch (error) {
        console.error('[Notification Controller] Error sending reconnect notification:', error);
        res.status(500).json({ 
            message: 'Failed to send notification',
            error: error.message 
        });
    }
};

