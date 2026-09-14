/**
 * Menonaktifkan 2FA user yang kehilangan HP dan kode cadangan (dijalankan Super Admin di server).
 * Jalankan: node scripts/reset-2fa.js --username budi   atau   --id 12
 * Semua sesi user ikut dicabut.
 */
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/config/database');

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const m = argv[i].match(/^--([a-zA-Z]+)$/);
        if (m) { out[m[1]] = argv[i + 1]; i++; }
    }
    return out;
}

function ask(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(query, (v) => { rl.close(); resolve(String(v).trim()); });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const id = args.id ? Number(args.id) : null;
    let username = args.username;
    if (!username && !id) username = await ask('Username yang 2FA-nya mau direset: ');

    const [rows] = await pool.query(
        `SELECT id, username, totp_enabled FROM users WHERE ${id ? 'id = ?' : 'username = ?'}`,
        [id || username]
    );
    if (rows.length === 0) { console.error('User tidak ditemukan.'); process.exit(1); }
    const user = rows[0];
    if (!user.totp_enabled) { console.log(`2FA user ${user.username} memang belum aktif.`); process.exit(0); }

    const answer = await ask(`Nonaktifkan 2FA dan cabut semua sesi ${user.username} (id ${user.id})? ketik "ya": `);
    if (answer.toLowerCase() !== 'ya') { console.log('Dibatalkan.'); process.exit(0); }

    await pool.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?', [user.id]);
    await pool.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [user.id]);
    await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
    console.log(`2FA ${user.username} dinonaktifkan. Minta user login dengan password lalu aktifkan 2FA lagi.`);
    process.exit(0);
}

main().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
