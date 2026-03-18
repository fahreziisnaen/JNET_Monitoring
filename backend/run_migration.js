
const pool = require('./backend/src/config/database');

async function runMigration() {
    try {
        console.log('Running migration: ADD reconnect_notification_sent to downtime_events');
        await pool.query('ALTER TABLE downtime_events ADD COLUMN reconnect_notification_sent BOOLEAN DEFAULT FALSE');
        console.log('Migration completed successfully');
    } catch (error) {
        if (error.code === 'ER_DUP_COLUMN_NAME' || error.message.includes('Duplicate column name')) {
            console.log('Column reconnect_notification_sent already exists, skipping.');
        } else {
            console.error('Migration failed:', error.message);
        }
    } finally {
        process.exit(0);
    }
}

runMigration();
