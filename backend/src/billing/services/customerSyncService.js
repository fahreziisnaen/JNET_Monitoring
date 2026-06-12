/**
 * customerSyncService.js
 * Menjembatani data `clients` (peta/monitoring) ke `billing_customers`.
 * Dipakai oleh import massal di panel billing dan auto-sync saat client dibuat.
 */
const pool = require('../../config/database');
const { normalizeWa } = require('../utils/phone');

/**
 * Buat/relink satu billing_customer dari sebuah baris client.
 * Tidak pernah melempar error fatal ke pemanggil monitoring — kembalikan status.
 * @returns {'created'|'relinked'|'exists'|'skipped_no_wa'|'skipped_dup_wa'}
 */
async function upsertFromClient({ workspaceId, clientId, name, whatsapp, secret, deviceId }) {
    const wa = normalizeWa(whatsapp);
    if (!wa) return 'skipped_no_wa';

    // Sudah ada billing_customer untuk client ini?
    if (clientId) {
        const [byClient] = await pool.query(
            'SELECT id FROM billing_customers WHERE workspace_id = ? AND client_id = ? LIMIT 1',
            [workspaceId, clientId]
        );
        if (byClient.length) return 'exists';
    }

    // WA sudah dipakai billing_customer lain (unik per-workspace)?
    const [byWa] = await pool.query(
        'SELECT id, client_id FROM billing_customers WHERE workspace_id = ? AND whatsapp_number = ? LIMIT 1',
        [workspaceId, wa]
    );
    if (byWa.length) {
        // Jika baris itu belum tertaut client, tautkan ke client ini.
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
