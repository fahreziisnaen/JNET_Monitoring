/**
 * billingScheduler.js
 * Engine billing berjadwal: generate invoice bulanan, reminder WA, dan
 * auto-isolir setelah masa tenggang (grace) habis.
 *
 * STATUS: SCAFFOLD. Engine ini MATI secara default. Aktifkan dengan env
 * `BILLING_SCHEDULER_ENABLED=true` HANYA setelah:
 *   - migrasi billing_module.sql dijalankan,
 *   - paket/pelanggan/langganan terisi,
 *   - billing_settings (grace, reminder, auto_isolir) dikonfigurasi.
 *
 * Logika inti generate-invoice & isolir SUDAH nyata (reuse service). Bagian
 * reminder WA & seleksi kandidat auto-isolir ditandai sebagai titik lanjutan
 * agar tidak mengirim pesan/aksi tak disengaja sebelum diverifikasi.
 */
const cron = require('node-cron');
const pool = require('../config/database');
const { generateInvoicesForWorkspace } = require('./services/billingService');
const isolirService = require('./services/isolirService');
const { sendWhatsAppMessage, isWhatsAppConnected } = require('../services/whatsappService');

const TZ = process.env.BILLING_TZ || 'Asia/Jakarta';

/** Generate invoice untuk semua workspace yg hari ini = invoice_gen_day. */
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

/**
 * Tandai invoice lewat jatuh tempo jadi 'overdue', kirim reminder, dan
 * auto-isolir setelah grace habis (jika diaktifkan per workspace).
 */
async function runOverdueAndIsolir() {
    // 1. Tandai overdue
    await pool.query(
        "UPDATE billing_invoices SET status = 'overdue' WHERE status = 'unpaid' AND due_date < CURDATE()"
    );

    // 2. Ambil kandidat isolir: overdue melewati grace, workspace dgn auto_isolir aktif.
    const [candidates] = await pool.query(
        `SELECT i.id AS invoice_id, i.workspace_id, i.due_date,
                c.id AS customer_id, c.pppoe_secret_name, c.device_id, c.whatsapp_number, c.name,
                s.grace_days, s.auto_isolir_enabled, s.isolir_profile
         FROM billing_invoices i
         JOIN billing_customers c ON c.id = i.customer_id
         JOIN billing_settings s ON s.workspace_id = i.workspace_id
         WHERE i.status = 'overdue'
           AND s.auto_isolir_enabled = 1
           AND DATE_ADD(i.due_date, INTERVAL s.grace_days DAY) < CURDATE()`
    );

    for (const cand of candidates) {
        if (!cand.pppoe_secret_name) continue;
        try {
            const r = await isolirService.isolateCustomer({
                workspaceId: cand.workspace_id,
                deviceId: cand.device_id,
                secretName: cand.pppoe_secret_name,
                isolirProfile: cand.isolir_profile || 'Isolir',
            });
            console.log(`[Billing][Scheduler] Auto-isolir ${cand.pppoe_secret_name}: ${r.message}`);

            // TODO(lanjutan): kirim WA pemberitahuan isolir & catat status agar tidak spam.
            if (cand.whatsapp_number && isWhatsAppConnected()) {
                await sendWhatsAppMessage(
                    cand.whatsapp_number,
                    `Mohon maaf ${cand.name || ''}, layanan internet Anda dinonaktifkan sementara karena tagihan belum dibayar. Silakan lakukan pembayaran untuk mengaktifkan kembali.`
                );
            }
        } catch (e) {
            console.error(`[Billing][Scheduler] Auto-isolir gagal ${cand.pppoe_secret_name}:`, e.message);
        }
    }
}

/**
 * TODO(lanjutan): reminder H- sebelum jatuh tempo (reminder_days_before).
 * Dibiarkan stub agar tidak mengirim WA massal sebelum diverifikasi & ada
 * pelacakan "sudah dikirim" untuk menghindari duplikasi.
 */
async function runReminders() {
    // Placeholder — implementasikan saat siap, dengan tabel/kolom penanda terkirim.
}

function startBillingScheduler() {
    if (process.env.BILLING_SCHEDULER_ENABLED !== 'true') {
        console.log('[Billing][Scheduler] NONAKTIF (set BILLING_SCHEDULER_ENABLED=true untuk mengaktifkan).');
        return;
    }

    // Generate invoice tiap hari 01:00
    cron.schedule('0 1 * * *', () => {
        runDailyInvoiceGeneration().catch((e) => console.error('[Billing][Scheduler] invoice:', e.message));
    }, { timezone: TZ });

    // Overdue + auto-isolir tiap hari 09:00
    cron.schedule('0 9 * * *', () => {
        runOverdueAndIsolir().catch((e) => console.error('[Billing][Scheduler] overdue:', e.message));
        runReminders().catch((e) => console.error('[Billing][Scheduler] reminder:', e.message));
    }, { timezone: TZ });

    console.log('[Billing][Scheduler] AKTIF — invoice 01:00, overdue/isolir 09:00 (' + TZ + ').');
}

module.exports = { startBillingScheduler, runDailyInvoiceGeneration, runOverdueAndIsolir, runReminders };
