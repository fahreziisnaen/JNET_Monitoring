const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
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

function askHidden(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        process.stdout.write(query);
        rl.stdoutMuted = true;
        rl._writeToOutput = function (s) { if (!rl.stdoutMuted) rl.output.write(s); };
        rl.question('', (v) => { rl.close(); process.stdout.write('\n'); resolve(String(v)); });
    });
}

function superAdminIds() {
    return process.env.SUPER_ADMIN_IDS
        ? process.env.SUPER_ADMIN_IDS.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean)
        : [1];
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    let username = args.username;
    const id = args.id ? Number(args.id) : null;
    if (!username && !id) username = (await ask('Username yang mau direset: ')).trim();

    const where = id ? 'id = ?' : 'username = ?';
    const [rows] = await pool.query(`SELECT id, username, whatsapp_number FROM users WHERE ${where}`, [id || username]);
    if (rows.length === 0) { console.error('User tidak ditemukan.'); process.exit(1); }
    const user = rows[0];

    let password = args.password;
    if (!password) {
        const p1 = await askHidden(`Password baru untuk "${user.username}" (id ${user.id}): `);
        const p2 = await askHidden('Ulangi password: ');
        if (p1 !== p2) { console.error('Password tidak cocok.'); process.exit(1); }
        password = p1;
    }
    if (!password || password.length < 6) { console.error('Password minimal 6 karakter.'); process.exit(1); }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);

    console.log(`\n✅ Password user "${user.username}" (id ${user.id}) berhasil diganti. Tidak perlu restart backend.`);

    const isSuper = superAdminIds().includes(user.id);
    console.log(isSuper
        ? `Status superadmin: YA (id ${user.id} ada di SUPER_ADMIN_IDS).`
        : `Status superadmin: TIDAK. Tambahkan id ${user.id} ke SUPER_ADMIN_IDS di .env lalu pm2 restart backend.`);
    if (user.whatsapp_number) {
        console.log(`\nCatatan login: jika bot WhatsApp aktif, sistem mengirim OTP ke ${user.whatsapp_number}. Pastikan OTP itu sampai agar login tuntas.`);
    }

    await pool.end();
    process.exit(0);
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
