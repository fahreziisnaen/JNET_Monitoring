const pool = require('./src/config/database');
(async () => {
    try {
        const [users] = await pool.query('SELECT id, username, role FROM users');
        console.log(JSON.stringify(users, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit();
})();
