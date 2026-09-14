/**
 * workspaceAccess.js
 * Satu-satunya aturan untuk mengakses workspace selain workspace milik user sendiri.
 */
const pool = require('../config/database');

/**
 * Menentukan hak akses user ke workspace lain.
 * Super Admin dan Global API Key boleh ke mana saja; user lain (role apa pun) butuh izin di noc_permissions.
 * @returns {Promise<'full'|'noc'|null>} 'full' = akses penuh, 'noc' = hak setara NOC, null = ditolak
 */
async function getWorkspaceAccess({ userId, isSuperAdmin, isGlobalKey }, targetWorkspaceId) {
    if (isSuperAdmin || isGlobalKey) return 'full';
    if (!userId || userId < 0) return null;

    const [perms] = await pool.query(
        'SELECT id FROM noc_permissions WHERE user_id = ? AND workspace_id = ?',
        [userId, targetWorkspaceId]
    );
    return perms.length > 0 ? 'noc' : null;
}

/**
 * Daftar workspace yang boleh dibaca user: workspace sendiri + izin NOC.
 * @returns {Promise<number[]|null>} null berarti semua workspace (Super Admin / Global API Key)
 */
async function getAccessibleWorkspaceIds(user) {
    if (user.is_super_admin || user.is_global_key) return null;

    const ids = new Set();
    if (user.home_workspace_id) ids.add(user.home_workspace_id);
    if (user.id > 0) {
        const [perms] = await pool.query('SELECT workspace_id FROM noc_permissions WHERE user_id = ?', [user.id]);
        perms.forEach(p => ids.add(p.workspace_id));
    }
    return [...ids];
}

module.exports = { getWorkspaceAccess, getAccessibleWorkspaceIds };
