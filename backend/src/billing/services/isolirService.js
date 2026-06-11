/**
 * isolirService.js
 * Jembatan billing -> aksi isolir/unisolir PPPoE di monitoring.
 *
 * PRINSIP (lihat memori billing-app-plan): monitoring tetap satu-satunya
 * pemilik interaksi MikroTik. Service ini REUSE helper `runCommandForWorkspace`
 * yang sama dengan pppoeController, jadi logikanya identik — bukan duplikasi
 * koneksi. Dipanggil oleh engine billing (scheduler) & webhook pembayaran.
 *
 * Catatan: ini sengaja TIDAK meng-import pppoeController (yang berbasis req/res).
 * Logika inti isolir cukup sederhana untuk direplikasi di sini secara aman.
 */
const pool = require('../../config/database');
const { runCommandForWorkspace } = require('../../utils/apiConnection');

let broadcast = null;
let mikrotikStore = null;
try {
    broadcast = require('../../utils/broadcast');
    mikrotikStore = require('../../utils/mikrotikStore');
} catch {
    /* opsional — tetap jalan walau modul realtime tak tersedia */
}

function notifyStore(workspaceId, deviceId, name, profile) {
    try {
        mikrotikStore?.updateSecret(workspaceId, deviceId, 'change', { name, profile, isActive: false });
        broadcast?.broadcastSinglePppoeUpdate(workspaceId, deviceId, name);
    } catch {
        /* non-fatal */
    }
}

/**
 * Isolir pelanggan: ubah profil PPPoE ke `isolirProfile` lalu kick.
 * @returns {Promise<{ok:boolean, message:string}>}
 */
async function isolateCustomer({ workspaceId, deviceId, secretName, isolirProfile = 'Isolir' }) {
    if (!secretName) return { ok: false, message: 'pppoe_secret_name kosong' };

    const secretData = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [`?name=${secretName}`], deviceId);
    if (!secretData || secretData.length === 0) {
        return { ok: false, message: 'Secret tidak ditemukan di router' };
    }
    const current = secretData[0];
    if (current.profile === isolirProfile) {
        return { ok: true, message: 'Sudah dalam status isolir' };
    }

    await runCommandForWorkspace(workspaceId, '/ppp/secret/set', [`=.id=${current['.id']}`, `=profile=${isolirProfile}`], deviceId);

    // Simpan profil sebelumnya ke cache pppoe_secrets (dipakai unisolir)
    await pool.query(
        'UPDATE pppoe_secrets SET profile = ?, previous_profile = ? WHERE workspace_id = ? AND name = ?',
        [isolirProfile, current.profile, workspaceId, secretName]
    ).catch(() => {});

    // Kick agar profil baru langsung berlaku
    const active = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [`?name=${secretName}`], deviceId);
    for (const a of active || []) {
        await runCommandForWorkspace(workspaceId, '/ppp/active/remove', [`=.id=${a['.id']}`], deviceId).catch(() => {});
    }

    notifyStore(workspaceId, deviceId, secretName, isolirProfile);
    return { ok: true, message: `Pelanggan ${secretName} di-isolir` };
}

/**
 * Buka isolir: kembalikan profil ke `targetProfile` (atau previous_profile dari cache).
 * @returns {Promise<{ok:boolean, message:string, profile:string}>}
 */
async function restoreCustomer({ workspaceId, deviceId, secretName, targetProfile = null }) {
    if (!secretName) return { ok: false, message: 'pppoe_secret_name kosong' };

    const secretData = await runCommandForWorkspace(workspaceId, '/ppp/secret/print', [`?name=${secretName}`], deviceId);
    if (!secretData || secretData.length === 0) {
        return { ok: false, message: 'Secret tidak ditemukan di router' };
    }
    const realId = secretData[0]['.id'];

    let profile = targetProfile;
    if (!profile) {
        const [rows] = await pool.query(
            'SELECT previous_profile FROM pppoe_secrets WHERE workspace_id = ? AND name = ?',
            [workspaceId, secretName]
        );
        profile = rows[0]?.previous_profile || 'default';
    }

    await runCommandForWorkspace(workspaceId, '/ppp/secret/set', [`=.id=${realId}`, `=profile=${profile}`], deviceId);
    await pool.query(
        'UPDATE pppoe_secrets SET profile = ?, previous_profile = NULL WHERE workspace_id = ? AND name = ?',
        [profile, workspaceId, secretName]
    ).catch(() => {});

    const active = await runCommandForWorkspace(workspaceId, '/ppp/active/print', [`?name=${secretName}`], deviceId);
    for (const a of active || []) {
        await runCommandForWorkspace(workspaceId, '/ppp/active/remove', [`=.id=${a['.id']}`], deviceId).catch(() => {});
    }

    notifyStore(workspaceId, deviceId, secretName, profile);
    return { ok: true, message: `Isolir ${secretName} dibuka`, profile };
}

module.exports = { isolateCustomer, restoreCustomer };
