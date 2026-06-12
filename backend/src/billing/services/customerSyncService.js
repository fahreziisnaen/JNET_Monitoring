const pool = require('../../config/database');
const { normalizeWa } = require('../utils/phone');

async function upsertFromClient({ workspaceId, clientId, name, whatsapp, secret, deviceId }) {
    const wa = normalizeWa(whatsapp);
    if (!wa) return 'skipped_no_wa';

    if (clientId) {
        const [byClient] = await pool.query(
            'SELECT id FROM billing_customers WHERE workspace_id = ? AND client_id = ? LIMIT 1',
            [workspaceId, clientId]
        );
        if (byClient.length) return 'exists';
    }

    const [byWa] = await pool.query(
        'SELECT id, client_id FROM billing_customers WHERE workspace_id = ? AND whatsapp_number = ? LIMIT 1',
        [workspaceId, wa]
    );
    if (byWa.length) {
        if (clientId && byWa[0].client_id == null) {
            await pool.query('UPDATE billing_customers SET client_id = ? WHERE id = ?', [clientId, byWa[0].id]);
            return 'relinked';
        }
        return 'skipped_dup_wa';
    }

    await pool.query(
        `INSERT INTO billing_customers (workspace_id, client_id, device_id, pppoe_secret_name, name, whatsapp_number, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [workspaceId, clientId || null, deviceId || null, secret || null, name || null, wa]
    );
    return 'created';
}

module.exports = { upsertFromClient };
