const path = require('path');

const store = { sub: null, packages: {}, noSecret: false };
const calls = { isolate: [], restore: [], change: [] };

function norm(sql) { return sql.replace(/\s+/g, ' ').trim(); }

async function runQuery(sql, params = []) {
    const s = norm(sql);

    if (s.startsWith('SELECT customer_id, package_id, status FROM billing_subscriptions WHERE id')) {
        return [[{ customer_id: store.sub.customer_id, package_id: store.sub.package_id, status: store.sub.status }]];
    }
    if (s.startsWith('UPDATE billing_subscriptions SET')) {
        const [pkg, status] = params;
        if (pkg != null) store.sub.package_id = pkg;
        if (status != null) store.sub.status = status;
        return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT c.pppoe_secret_name, c.device_id, p.pppoe_profile, st.isolir_profile FROM billing_customers')) {
        if (store.noSecret) return [[{ pppoe_secret_name: null, device_id: null, pppoe_profile: null, isolir_profile: 'ISOLIR' }]];
        return [[{ pppoe_secret_name: 'budi', device_id: 5, pppoe_profile: store.packages[store.sub.package_id] || null, isolir_profile: 'ISOLIR' }]];
    }
    if (s.startsWith('SELECT c.pppoe_secret_name, c.device_id, p.pppoe_profile FROM billing_customers')) {
        const pkgId = params[0];
        return [[{ pppoe_secret_name: 'budi', device_id: 5, pppoe_profile: store.packages[pkgId] || null }]];
    }
    throw new Error('Unhandled SQL: ' + s);
}

const fakePool = { query: (sql, params) => runQuery(sql, params) };
const fakeIsolir = {
    isolateCustomer: async (a) => { calls.isolate.push(a); return { ok: true, message: `isolir ${a.secretName}` }; },
    restoreCustomer: async (a) => { calls.restore.push(a); return { ok: true, message: `buka ${a.secretName}`, profile: a.targetProfile }; },
    changeProfile: async (a) => { calls.change.push(a); return { ok: true, message: `ubah ${a.secretName}`, profile: a.profile }; },
};

function inject(rel, exportsObj) {
    const abs = require.resolve(path.join(__dirname, '..', rel));
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}
inject('src/config/database.js', fakePool);
inject('src/billing/services/isolirService.js', fakeIsolir);

const ctrl = require('../src/billing/controllers/billingAdminController');

function makeReq(id, body) {
    return { user: { workspace_id: 1, role: 'admin', is_super_admin: false }, query: {}, params: { id: String(id) }, body: body || {} };
}
function makeRes() {
    return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
}
function seed(over = {}) {
    store.sub = { customer_id: 100, package_id: 10, status: over.status || 'active' };
    store.packages = { 10: 'paket-10', 20: 'paket-20' };
    store.noSecret = over.noSecret || false;
    calls.isolate = []; calls.restore = []; calls.change = [];
}
async function update(id, body) {
    const res = makeRes();
    await ctrl.updateSubscription(makeReq(id, body), res);
    return res;
}

let failed = 0;
function assert(cond, label) {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
    if (!cond) failed++;
}

async function main() {
    // A. Aktif -> Isolir : harus memutus (isolateCustomer)
    seed({ status: 'active' });
    await update(1, { status: 'suspended' });
    assert(calls.isolate.length === 1 && calls.restore.length === 0, 'A: Aktif->Isolir memanggil isolateCustomer');
    assert(calls.isolate[0]?.secretName === 'budi' && calls.isolate[0]?.isolirProfile === 'ISOLIR', 'A: pakai secret & profil isolir dari settings');

    // B. Aktif -> Berhenti : TIDAK menyentuh router (cukup hapus user bila perlu)
    seed({ status: 'active' });
    const rB = await update(1, { status: 'cancelled' });
    assert(calls.isolate.length === 0 && calls.restore.length === 0 && calls.change.length === 0, 'B: Aktif->Berhenti tidak menyentuh router');
    assert(rB.body?.isolir == null, 'B: response isolir = null untuk Berhenti');
    assert(rB.statusCode === 200, 'B: balas 200');

    // C. Isolir -> Aktif : harus membuka (restoreCustomer) ke profil paket
    seed({ status: 'suspended' });
    await update(1, { status: 'active' });
    assert(calls.restore.length === 1 && calls.isolate.length === 0, 'C: Isolir->Aktif memanggil restoreCustomer');
    assert(calls.restore[0]?.targetProfile === 'paket-10', 'C: restore ke profil paket (paket-10)');

    // D. Tanpa ubah status (hanya due_day) : tidak menyentuh router
    seed({ status: 'active' });
    const rD = await update(1, { due_day_of_month: 15 });
    assert(calls.isolate.length === 0 && calls.restore.length === 0 && calls.change.length === 0, 'D: ubah due_day tidak menyentuh router');
    assert(rD.statusCode === 200, 'D: balas 200');

    // E. Ganti paket saat Aktif : sync profil (changeProfile), bukan isolir
    seed({ status: 'active' });
    await update(1, { package_id: 20 });
    assert(calls.change.length === 1 && calls.isolate.length === 0 && calls.restore.length === 0, 'E: ganti paket -> changeProfile');
    assert(calls.change[0]?.profile === 'paket-20', 'E: profil disync ke paket baru (paket-20)');

    // F. Pelanggan tanpa secret : router dilewati, ditandai skipped
    seed({ status: 'active', noSecret: true });
    const rF = await update(1, { status: 'suspended' });
    assert(calls.isolate.length === 0 && calls.restore.length === 0, 'F: tanpa secret -> router tidak dipanggil');
    assert(rF.body?.isolir?.skipped === true, 'F: response menandai isolir.skipped = true');

    console.log('\n' + (failed === 0 ? '✅ SEMUA LULUS' : `❌ ${failed} GAGAL`));
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
