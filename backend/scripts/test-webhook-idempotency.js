const path = require('path');

const store = {
    payments: [],
    invoices: [],
    customers: [],
};
let restoreCalls = [];

function norm(sql) {
    return sql.replace(/\s+/g, ' ').trim();
}

async function runQuery(sql, params = []) {
    const s = norm(sql);

    if (s.startsWith('SELECT id FROM billing_payments WHERE merchant_ref')) {
        const ref = params[0];
        return [store.payments.filter(p => p.merchant_ref === ref).map(p => ({ id: p.id }))];
    }
    if (s.startsWith('SELECT * FROM billing_payments WHERE id')) {
        const id = params[0];
        return [store.payments.filter(p => p.id === id).map(p => ({ ...p }))];
    }
    if (s.startsWith('UPDATE billing_payments SET status')) {
        const [status, providerRef, paidAt, raw, id] = params;
        const p = store.payments.find(x => x.id === id);
        p.status = status;
        if (providerRef != null) p.provider_ref = providerRef;
        p.paid_at = p.paid_at != null ? p.paid_at : paidAt; // COALESCE(paid_at, ?)
        p.raw_response = raw;
        return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT * FROM billing_invoices WHERE id')) {
        const id = params[0];
        return [store.invoices.filter(i => i.id === id).map(i => ({ ...i }))];
    }
    if (s.startsWith("UPDATE billing_invoices SET status = 'paid'")) {
        const [paidAt, id] = params;
        const inv = store.invoices.find(x => x.id === id);
        inv.status = 'paid';
        inv.paid_at = inv.paid_at != null ? inv.paid_at : paidAt; // COALESCE(paid_at, ?)
        return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT bc.*, p.pppoe_profile FROM billing_customers')) {
        const custId = params[1];
        return [store.customers.filter(c => c.id === custId).map(c => ({ ...c }))];
    }
    throw new Error('Unhandled SQL: ' + s);
}

const fakePool = {
    query: (sql, params) => runQuery(sql, params),
    getConnection: async () => ({
        query: (sql, params) => runQuery(sql, params),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
    }),
};

const fakeIsolir = {
    restoreCustomer: async (args) => { restoreCalls.push(args); },
    isolateCustomer: async () => {},
    changeProfile: async () => {},
};

function inject(relFromBackend, exportsObj) {
    const abs = require.resolve(path.join(__dirname, '..', relFromBackend));
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

inject('src/config/database.js', fakePool);
inject('src/billing/services/isolirService.js', fakeIsolir);

const paymentController = require('../src/billing/controllers/paymentController');

function makeReq(payload) {
    return { rawBody: JSON.stringify(payload), body: payload, headers: {} };
}
function makeRes() {
    return {
        statusCode: null,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(o) { this.body = o; return this; },
    };
}

const logs = [];
const origLog = console.log;
const origWarn = console.warn;
console.log = (...a) => { logs.push(a.join(' ')); };
console.warn = (...a) => { logs.push(a.join(' ')); };

let failed = 0;
function assert(cond, label) {
    const line = `${cond ? 'PASS' : 'FAIL'}  ${label}`;
    origLog(line);
    if (!cond) failed++;
}

async function callWebhook(payload) {
    const res = makeRes();
    await paymentController.tripayCallback(makeReq(payload), res);
    return res;
}

function seed() {
    store.payments = [{ id: 1, merchant_ref: 'INV-TEST-1', invoice_id: 10, status: 'pending', provider_ref: null, paid_at: null, raw_response: null }];
    store.invoices = [{ id: 10, workspace_id: 1, subscription_id: 100, customer_id: 1000, status: 'unpaid', paid_at: null }];
    store.customers = [{ id: 1000, workspace_id: 1, device_id: 5, pppoe_secret_name: 'test-secret', pppoe_profile: 'paket-10mbps' }];
    restoreCalls = [];
    logs.length = 0;
}

async function main() {
    // Skenario 1: PAID pertama lalu PAID duplikat ---------------------------
    seed();
    const r1 = await callWebhook({ merchant_ref: 'INV-TEST-1', status: 'PAID', reference: 'TRP-AAA' });
    const p = store.payments[0];
    const inv = store.invoices[0];
    const firstPaymentPaidAt = p.paid_at;
    const firstInvoicePaidAt = inv.paid_at;

    assert(r1.statusCode === 200, 'PAID pertama balas 200');
    assert(p.status === 'paid', 'payment.status -> paid');
    assert(inv.status === 'paid', 'invoice.status -> paid');
    assert(firstPaymentPaidAt != null, 'payment.paid_at terisi');
    assert(firstInvoicePaidAt != null, 'invoice.paid_at terisi');
    assert(restoreCalls.length === 1, 'restoreCustomer dipanggil 1x');
    assert(restoreCalls[0] && restoreCalls[0].secretName === 'test-secret' && restoreCalls[0].targetProfile === 'paket-10mbps', 'restore args benar (secret+profile)');

    await new Promise(res => setTimeout(res, 5)); // pastikan Date() berikutnya beda kalau sampai ketimpa
    const r2 = await callWebhook({ merchant_ref: 'INV-TEST-1', status: 'PAID', reference: 'TRP-BBB' });

    assert(r2.statusCode === 200, 'PAID duplikat tetap balas 200 (ack, stop retry)');
    assert(p.paid_at === firstPaymentPaidAt, 'payment.paid_at TIDAK ketimpa oleh duplikat');
    assert(inv.paid_at === firstInvoicePaidAt, 'invoice.paid_at TIDAK ketimpa oleh duplikat');
    assert(p.provider_ref === 'TRP-AAA', 'provider_ref tetap dari callback pertama (bukan TRP-BBB)');
    assert(restoreCalls.length === 1, 'restoreCustomer TIDAK dipanggil ulang (tetap 1x)');
    assert(logs.some(l => l.includes('Callback duplikat')), 'log "Callback duplikat" muncul');

    // Skenario 2: anti-downgrade (EXPIRED usang setelah PAID) ---------------
    const r3 = await callWebhook({ merchant_ref: 'INV-TEST-1', status: 'EXPIRED', reference: 'TRP-CCC' });
    assert(r3.statusCode === 200, 'EXPIRED usang balas 200');
    assert(p.status === 'paid', 'payment tetap paid (tidak downgrade)');
    assert(inv.status === 'paid', 'invoice tetap paid (tidak downgrade)');
    assert(logs.some(l => l.includes('sudah lunas')), 'log anti-downgrade muncul');

    // Skenario 3: EXPIRED pertama lalu EXPIRED duplikat (non-paid path) -----
    seed();
    const e1 = await callWebhook({ merchant_ref: 'INV-TEST-1', status: 'EXPIRED', reference: 'TRP-DDD' });
    assert(e1.statusCode === 200, 'EXPIRED pertama balas 200');
    assert(store.payments[0].status === 'expired', 'payment.status -> expired');
    assert(store.invoices[0].status === 'unpaid', 'invoice tetap unpaid saat expired');
    assert(restoreCalls.length === 0, 'restore tidak dipanggil untuk expired');

    logs.length = 0;
    const e2 = await callWebhook({ merchant_ref: 'INV-TEST-1', status: 'EXPIRED', reference: 'TRP-EEE' });
    assert(e2.statusCode === 200, 'EXPIRED duplikat balas 200');
    assert(logs.some(l => l.includes('Callback duplikat')), 'log duplikat muncul untuk expired berulang');

    // Skenario 4: merchant_ref tak dikenal ---------------------------------
    const u = await callWebhook({ merchant_ref: 'TIDAK-ADA', status: 'PAID' });
    assert(u.statusCode === 404, 'merchant_ref tak dikenal -> 404');

    console.log = origLog;
    console.warn = origWarn;
    origLog('\n' + (failed === 0 ? '✅ SEMUA LULUS' : `❌ ${failed} GAGAL`));
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log = origLog; console.error('Error:', e); process.exit(1); });
