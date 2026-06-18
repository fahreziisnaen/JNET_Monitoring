const pool = require('../src/config/database');

(async () => {
    const [rows] = await pool.query(
        `SELECT id, customer_id, start_date AS date_obj,
                DATE_FORMAT(start_date, '%Y-%m-%d') AS stored_in_db
         FROM billing_subscriptions
         ORDER BY created_at DESC LIMIT 3`
    );
    for (const r of rows) {
        const servedNow = r.date_obj instanceof Date ? r.date_obj.toISOString().slice(0, 10) : String(r.date_obj).slice(0, 10);
        console.log({
            id: r.id,
            customer_id: r.customer_id,
            stored_in_db: r.stored_in_db,
            served_to_frontend_now: servedNow,
            mundur_1_hari: r.stored_in_db !== servedNow,
        });
    }
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
