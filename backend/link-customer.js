const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const m = require('mysql2/promise');
(async () => {
  const c = await m.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const wa = '6282313230420';
  const [cl] = await c.query(
    'SELECT id,device_id,client_name,pppoe_secret_name ' +
    'FROM clients WHERE whatsapp_number LIKE ?',
    ['%82313230420%']
  );
  console.log('client cocok:', cl);
  if (cl.length === 1) {
    const k = cl[0];
    await c.query(
      'UPDATE billing_customers SET ' +
      'client_id=?,device_id=?,name=?,pppoe_secret_name=? ' +
      'WHERE whatsapp_number=?',
      [k.id, k.device_id, k.client_name, k.pppoe_secret_name, wa]
    );
    console.log('TERTAUT ke client', k.id);
  } else {
    console.log('Match != 1, tidak auto-update. Lihat daftar di atas.');
  }
  const [bc] = await c.query(
    'SELECT * FROM billing_customers WHERE whatsapp_number=?', [wa]
  );
  console.log('billing_customer sekarang:', bc);
  await c.end();
})();
