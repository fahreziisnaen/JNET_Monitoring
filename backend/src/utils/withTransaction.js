const pool = require('../config/database');

async function withTransaction(fn) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        try { await conn.rollback(); } catch (rbErr) {
            console.error('[withTransaction] rollback gagal:', rbErr.message);
        }
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = withTransaction;
