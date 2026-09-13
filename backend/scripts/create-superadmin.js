const path = require('path');
const fs = require('fs');
const readline = require('readline');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/config/database');

const DEFAULT_AVATAR = '/public/uploads/avatars/default.jpg';
const ENV_PATH = path.join(__dirname, '..', '.env');

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--no-env') { out.noEnv = true; continue; }
        const m = a.match(/^--([a-zA-Z]+)$/);
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

function mergeSuperAdminIds(existingLine, newId) {
    let ids;
    if (existingLine == null) {
        ids = [1];
    } else {
        const raw = existingLine.slice(existingLine.indexOf('=') + 1);
        ids = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) ids = [1];
    }
    ids.push(newId);
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function updateEnvSuperAdmin(newId) {
    if (!fs.existsSync(ENV_PATH)) {
        return { ok: false, reason: 'missing', path: ENV_PATH };
    }
    const original = fs.readFileSync(ENV_PATH, 'utf8');
    const lines = original.split('\n');
    const idx = lines.findIndex((l) => /^\s*SUPER_ADMIN_IDS\s*=/.test(l));
    const merged = mergeSuperAdminIds(idx >= 0 ? lines[idx] : null, newId);
    const newLine = `SUPER_ADMIN_IDS=${merged.join(',')}`;

    if (idx >= 0) {
        if (lines[idx].trim() === newLine) return { ok: true, unchanged: true, value: newLine };
        lines[idx] = newLine;
    } else {
        if (lines.length && lines[lines.length - 1] === '') lines[lines.length - 1] = newLine;
        else lines.push(newLine);
        lines.push('');
    }

    fs.writeFileSync(`${ENV_PATH}.bak`, original, 'utf8');
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
    return { ok: true, value: newLine, backup: `${ENV_PATH}.bak` };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    let username = args.username || (await ask('Username superadmin: '));
    username = username.trim();
    if (!username) { console.error('Username wajib diisi.'); process.exit(1); }

    let displayName = args.name || (await ask(`Nama tampilan [${username}]: `));
    displayName = (displayName || '').trim() || username;

    let whatsapp = args.wa != null ? args.wa : (await ask('Nomor WhatsApp (opsional, Enter untuk kosong): '));
    whatsapp = (whatsapp || '').trim() || null;

    let password = args.password;
    if (!password) {
        const p1 = await askHidden('Password: ');
        const p2 = await askHidden('Ulangi password: ');
        if (p1 !== p2) { console.error('Password tidak cocok.'); process.exit(1); }
        password = p1;
    }
    if (!password || password.length < 6) { console.error('Password minimal 6 karakter.'); process.exit(1); }

    const [conflict] = await pool.query(
        'SELECT id, username FROM users WHERE username = ?' + (whatsapp ? ' OR whatsapp_number = ?' : ''),
        whatsapp ? [username, whatsapp] : [username]
    );
    if (conflict.length > 0) {
        console.error(`Gagal: username atau nomor WhatsApp sudah dipakai (user id ${conflict[0].id}).`);
        process.exit(1);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    let newUserId;
    try {
        const [result] = await conn.query(
            'INSERT INTO users (username, display_name, password_hash, whatsapp_number, profile_picture_url, role) VALUES (?, ?, ?, ?, ?, ?)',
            [username, displayName, passwordHash, whatsapp, DEFAULT_AVATAR, 'admin']
        );
        newUserId = result.insertId;
        const [ws] = await conn.query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', [`${displayName}'s Workspace`, newUserId]);
        await conn.query('UPDATE users SET workspace_id = ? WHERE id = ?', [ws.insertId, newUserId]);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('Gagal membuat user:', e.message);
        process.exit(1);
    }
    conn.release();

    console.log(`\n✅ User dibuat: id=${newUserId}, username="${username}", role=admin`);

    if (args.noEnv) {
        console.log(`\nLewati update .env (--no-env). Tambahkan manual: SUPER_ADMIN_IDS harus memuat ${newUserId}.`);
    } else {
        const r = updateEnvSuperAdmin(newUserId);
        if (r.ok && r.unchanged) {
            console.log(`\n.env: SUPER_ADMIN_IDS sudah memuat id ${newUserId} (tidak diubah).`);
        } else if (r.ok) {
            console.log(`\n.env diperbarui -> ${r.value}`);
            if (r.backup) console.log(`Backup lama: ${r.backup}`);
        } else {
            console.log(`\n⚠️  .env tidak ditemukan di ${r.path}. Tambahkan manual baris:`);
            console.log(`   SUPER_ADMIN_IDS=1,${newUserId}`);
        }
    }

    console.log('\nLangkah terakhir: jalankan  pm2 restart backend  agar superadmin aktif.\n');
    await pool.end();
    process.exit(0);
}

if (require.main === module) {
    main().catch((e) => { console.error('Error:', e); process.exit(1); });
}

module.exports = { mergeSuperAdminIds };
