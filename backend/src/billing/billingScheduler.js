const cron = require('node-cron');
const pool = require('../config/database');
const { generateInvoicesForWorkspace } = require('./services/billingService');
const isolirService = require('./services/isolirService');
const { sendWhatsAppMessage, isWhatsAppConnected } = require('../services/whatsappService');

const TZ = process.env.BILLING_TZ || 'Asia/Jakarta';

async function runDailyInvoiceGeneration() {
    const today = new Date().getDate();
    const [wsRows] = await pool.query(
        'SELECT workspace_id FROM billing_settings WHERE invoice_gen_day = ?',
        [today]
    );
    for (const { workspace_id } of wsRows) {
        try {
            const summary = await generateInvoicesForWorkspace(workspace_id);
            console.log(`[Billing][Scheduler] Generate invoice ws ${workspace_id}:`, summary);
        } catch (e) {
            console.error(`[Billing][Scheduler] Gagal generate ws ${workspace_id}:`, e.message);
        }
    }
}

async function runOverdueAndIsolir() {
    await pool.query(
        "UPDATE billing_invoices SET status = 'overdue' WHERE status = 'unpaid' AND due_date < CURDATE()"
    );

    const [candidates] = await pool.query(
        `SELECT i.id AS invoice_id, i.workspace_id, i.due_date, i.isolir_notified_at,
                c.id AS customer_id, c.pppoe_secret_name, c.device_id, c.whatsapp_number, c.name,
                s.grace_days, s.auto_isolir_enabled, s.isolir_profile
         FROM billing_invoices i
         JOIN billing_customers c ON c.id = i.customer_id
         JOIN billing_settings s ON s.workspace_id = i.workspace_id
         WHERE i.status = 'overdue'
           AND s.auto_isolir_enabled = 1
           AND DATE_ADD(i.due_date, INTERVAL s.grace_days DAY) < CURDATE()`
    );

    // Satu pelanggan bisa punya beberapa invoice overdue: isolir & beri tahu sekali per pelanggan
    const byCustomer = new Map();
    for (const cand of candidates) {
        if (!byCustomer.has(cand.customer_id)) byCustomer.set(cand.customer_id, []);
        byCustomer.get(cand.customer_id).push(cand);
    }

    for (const invoices of byCustomer.values()) {
        const cand = invoices[0];
        if (!cand.pppoe_secret_name) continue;
        try {
            const r = await isolirService.isolateCustomer({
                workspaceId: cand.workspace_id,
                deviceId: cand.device_id,
                secretName: cand.pppoe_secret_name,
                isolirProfile: cand.isolir_profile || 'Isolir',
            });
            console.log(`[Billing][Scheduler] Auto-isolir ${cand.pppoe_secret_name}: ${r.message}`);

            // Notifikasi hanya sekali per invoice; dulu terkirim setiap hari dan memicu ban nomor bot
            const unnotified = invoices.filter(i => !i.isolir_notified_at).map(i => i.invoice_id);
            if (r.ok && cand.whatsapp_number && unnotified.length > 0) {
                const queued = await sendWhatsAppMessage(
                    cand.whatsapp_number,
                    `Mohon maaf ${cand.name || ''}, layanan internet Anda dinonaktifkan sementara karena tagihan belum dibayar. Silakan lakukan pembayaran untuk mengaktifkan kembali.`,
                    { category: 'billing' }
                );
                if (queued) {
                    await pool.query('UPDATE billing_invoices SET isolir_notified_at = NOW() WHERE id IN (?)', [unnotified]);
                }
            }
        } catch (e) {
            console.error(`[Billing][Scheduler] Auto-isolir gagal ${cand.pppoe_secret_name}:`, e.message);
        }
    }
}

async function runReminders() {
}

function startBillingScheduler() {
    if (process.env.BILLING_SCHEDULER_ENABLED !== 'true') {
        console.log('[Billing][Scheduler] NONAKTIF (set BILLING_SCHEDULER_ENABLED=true untuk mengaktifkan).');
        return;
    }

    cron.schedule('0 1 * * *', () => {
        runDailyInvoiceGeneration().catch((e) => console.error('[Billing][Scheduler] invoice:', e.message));
    }, { timezone: TZ });

    cron.schedule('0 9 * * *', () => {
        runOverdueAndIsolir().catch((e) => console.error('[Billing][Scheduler] overdue:', e.message));
        runReminders().catch((e) => console.error('[Billing][Scheduler] reminder:', e.message));
    }, { timezone: TZ });

    console.log('[Billing][Scheduler] AKTIF — invoice 01:00, overdue/isolir 09:00 (' + TZ + ').');
}

module.exports = { startBillingScheduler, runDailyInvoiceGeneration, runOverdueAndIsolir, runReminders };
