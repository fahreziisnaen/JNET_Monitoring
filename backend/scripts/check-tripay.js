require('dotenv').config();
const axios = require('axios');
const tripay = require('../src/billing/services/tripayService');

async function main() {
    const c = tripay.getConfig();
    console.log('=== Konfigurasi Tripay yang dibaca backend (.env) ===');
    console.log('mode          :', c.mode);
    console.log('baseUrl       :', c.baseUrl);
    console.log('merchantCode  :', JSON.stringify(c.merchantCode));
    console.log('apiKey prefix :', JSON.stringify((c.apiKey || '').slice(0, 8)), '| panjang:', (c.apiKey || '').length);
    console.log('privateKey    : panjang', (c.privateKey || '').length);
    console.log('isConfigured  :', tripay.isConfigured());

    if ((c.apiKey || '') !== (c.apiKey || '').trim()) {
        console.log('PERINGATAN: apiKey punya spasi/baris di awal/akhir!');
    }
    if (c.apiKey && c.apiKey.startsWith('DEV-') && c.mode === 'production') {
        console.log('MASALAH: apiKey sandbox (DEV-) tapi TRIPAY_MODE=production. Set TRIPAY_MODE=sandbox.');
    }
    if (!tripay.isConfigured()) { console.log('-> Kredensial belum lengkap. Cek .env.'); return; }

    console.log('\n=== Uji API key ke Tripay (GET /merchant/payment-channel) ===');
    try {
        const r = await axios.get(`${c.baseUrl}/merchant/payment-channel`, {
            headers: { Authorization: `Bearer ${c.apiKey}` },
            timeout: 15000,
        });
        if (r.data && r.data.success) {
            const all = r.data.data || [];
            const active = all.filter((ch) => ch.active).map((ch) => ch.code);
            console.log('API KEY VALID.');
            console.log('Channel aktif :', active.join(', ') || '(tidak ada yang aktif)');
            console.log('QRIS aktif?   :', active.includes('QRIS') ? 'YA' : 'TIDAK -> aktifkan QRIS di dashboard, atau set TRIPAY_DEFAULT_CHANNEL ke channel aktif');
        } else {
            console.log('Tripay membalas success=false:', r.data && r.data.message);
        }
    } catch (e) {
        const data = e.response && e.response.data;
        console.log('GAGAL:', data ? JSON.stringify(data) : e.message);
        console.log('(Kalau ini "Invalid API Key": cek mode vs jenis key, atau key salah/terpotong.)');
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
