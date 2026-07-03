const { runCommandForWorkspace } = require('../utils/apiConnection');
const pool = require('../config/database');
const mikrotikStore = require('../utils/mikrotikStore');
const { refreshSecretsNow } = require('../bot/backgroundMonitor');
const broadcast = require('../utils/broadcast');
const fs = require('fs');
const path = require('path');

async function removeSecretFromMonitoring({ workspaceId, secretName, deviceId }) {
    if (!secretName) return { router_synced: false };

    let mikrotikId = null;
    try {
        const secretData = await runCommandForWorkspace(
            workspaceId,
            '/ppp/secret/print',
            [`?name=${secretName}`],
            deviceId,
            { timeout: 30000 }
        );
        if (secretData && secretData.length > 0) {
            mikrotikId = secretData[0]['.id'];
        }
    } catch (e) {
        console.warn(`[SecretDeletion] Gagal cek router (mungkin offline): ${e.message}`);
    }

    if (mikrotikId) {
        try {
            await runCommandForWorkspace(workspaceId, '/ppp/secret/remove', [`=.id=${mikrotikId}`], deviceId);
        } catch (e) {
            console.error(`[SecretDeletion] Gagal hapus dari Mikrotik: ${e.message}`);
        }
    }

    try {
        const [clientPhoto] = await pool.query(
            'SELECT photo_url FROM clients WHERE pppoe_secret_name = ? AND workspace_id = ?',
            [secretName, workspaceId]
        );
        if (clientPhoto.length > 0 && clientPhoto[0].photo_url) {
            const photoPath = path.join(__dirname, '../../', clientPhoto[0].photo_url);
            if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
        }
    } catch (e) {
        console.warn(`[SecretDeletion] Gagal hapus foto: ${e.message}`);
    }

    await pool.query(
        'DELETE FROM odp_user_connections WHERE workspace_id = ? AND pppoe_secret_name = ?',
        [workspaceId, secretName]
    );
    await pool.query(
        'DELETE FROM clients WHERE pppoe_secret_name = ? AND workspace_id = ?',
        [secretName, workspaceId]
    );

    mikrotikStore.markPendingDelete(workspaceId, deviceId, secretName);
    broadcast.broadcastSinglePppoeRemove(workspaceId, deviceId, secretName);
    refreshSecretsNow(workspaceId, deviceId);

    return { router_synced: !!mikrotikId };
}

module.exports = { removeSecretFromMonitoring };
