// Uji antrean pesan WhatsApp anti-ban dengan transport palsu dan jam palsu.
// Jalankan: node scripts/test-whatsapp-outbox.js
const { createOutbox } = require('../src/services/whatsappOutbox');

let failures = 0;
function check(label, ok, extra = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` (${extra})` : ''}`);
    if (!ok) failures++;
}

function setup({ limits = {}, ready = true } = {}) {
    const clock = { t: 1_000_000 };
    const sent = [];
    const typing = [];
    const transport = {
        ready,
        dead: false,
        invalid: new Set(),
        isReady() { return this.ready; },
        isDead() { return this.dead; },
        async resolveJid(target) {
            if (target.endsWith('@g.us')) return target;
            return this.invalid.has(target) ? null : `${target}@s.whatsapp.net`;
        },
        async simulateTyping(jid, text) { typing.push(jid); },
        async send(jid, text) { sent.push({ jid, text, at: clock.t }); },
    };
    const outbox = createOutbox({
        transport,
        now: () => clock.t,
        random: () => 0.5,
        log: { error() {}, log() {} },
        limits: { minDelayMs: 4000, maxDelayMs: 10000, hourlyLimit: 3, dailyLimit: 5, billingDailyLimit: 2, perRecipientHourly: 2, perGroupHourly: 3, ...limits },
    });
    return { clock, sent, typing, transport, outbox };
}

(async () => {
    // Pengiriman dasar + jeda acak + efek mengetik
    {
        const { outbox, sent, typing } = setup();
        check('enqueue alert tanpa menunggu langsung true', await outbox.enqueue('628111', 'halo') === true);
        const r = await outbox.processNext();
        check('processNext mengirim pesan', r.state === 'sent' && sent.length === 1 && sent[0].jid === '628111@s.whatsapp.net');
        check('jeda setelah kirim di antara min & max', r.waitMs >= 4000 && r.waitMs <= 10000, r.waitMs);
        check('efek mengetik dikirim sebelum pesan', typing[0] === '628111@s.whatsapp.net');
        check('antrean kosong → idle', (await outbox.processNext()).state === 'idle');
    }

    // Prioritas: OTP didahulukan walau masuk belakangan
    {
        const { outbox, sent } = setup();
        outbox.enqueue('628111', 'tagihan', { category: 'billing' });
        outbox.enqueue('120363@g.us', 'alert router', { category: 'alert' });
        const otpPromise = outbox.enqueue('628222', 'OTP 123456', { category: 'otp', waitForResult: true });
        await outbox.processNext();
        check('OTP dikirim pertama', sent[0].text === 'OTP 123456');
        check('waitForResult resolve true setelah terkirim', await otpPromise === true);
        await outbox.processNext();
        check('alert sebelum billing', sent[1].text === 'alert router');
    }

    // Alert ke grup yang sama digabung selama masih antre
    {
        const { outbox, sent } = setup();
        outbox.enqueue('120363@g.us', 'Router A offline');
        outbox.enqueue('120363@g.us', 'Router B offline');
        outbox.enqueue('120999@g.us', 'Router C offline');
        await outbox.processNext();
        check('2 alert ke grup sama jadi 1 pesan', sent.length === 1 && sent[0].text.includes('Router A') && sent[0].text.includes('Router B'), JSON.stringify(sent[0]?.text));
        check('alert ke grup lain tetap terpisah', outbox.stats().queued === 1);
    }

    // Pesan kembar dalam 10 menit dibuang
    {
        const { outbox, sent, clock } = setup();
        outbox.enqueue('628111', 'Perangkat X offline', { category: 'billing' });
        await outbox.processNext();
        outbox.enqueue('628111', 'Perangkat X offline', { category: 'billing' });
        check('pesan kembar tidak diantrekan lagi', outbox.stats().queued === 0);
        clock.t += 11 * 60 * 1000;
        outbox.enqueue('628111', 'Perangkat X offline', { category: 'billing' });
        check('setelah 10 menit boleh dikirim lagi', outbox.stats().queued === 1);
    }

    // Batas per penerima per jam
    {
        const { outbox, sent, clock } = setup({ limits: { hourlyLimit: 100, billingDailyLimit: 100 } });
        for (let i = 0; i < 3; i++) outbox.enqueue('628111', `pesan ${i}`, { category: 'billing' });
        await outbox.processNext(); await outbox.processNext();
        const r = await outbox.processNext();
        check('penerima sama maks 2/jam → pesan ke-3 ditahan', sent.length === 2 && r.state === 'throttled', r.state);
        check('waktu tunggu throttle sampai jendela terbuka', r.waitMs > 0 && r.waitMs <= 60 * 60 * 1000, r.waitMs);
        clock.t += 60 * 60 * 1000 + 1;
        await outbox.processNext();
        check('setelah 1 jam pesan ke-3 terkirim', sent.length === 3);
    }

    // Batas global per jam (OTP dikecualikan) dan per hari
    {
        const { outbox, sent } = setup();
        ['6281', '6282', '6283', '6284'].forEach(n => outbox.enqueue(n, `alert ${n}`, { category: 'alert' }));
        for (let i = 0; i < 4; i++) await outbox.processNext();
        check('global maks 3 pesan/jam untuk alert', sent.length === 3, sent.length);
        const otp = outbox.enqueue('6289', 'OTP 999', { category: 'otp', waitForResult: true });
        await outbox.processNext();
        check('OTP tetap terkirim walau kuota per jam habis', await otp === true && sent.length === 4);
        outbox.enqueue('6288', 'OTP 888', { category: 'otp' });
        await outbox.processNext();
        const otp3 = outbox.enqueue('6287', 'OTP 777', { category: 'otp' });
        const r = await outbox.processNext();
        check('kuota harian (5) juga berlaku untuk OTP', sent.length === 5 && r.state === 'throttled', `${sent.length} ${r.state}`);
    }

    // Batas harian khusus billing
    {
        const { outbox, sent, clock } = setup({ limits: { hourlyLimit: 100, dailyLimit: 100 } });
        ['6281', '6282', '6283'].forEach(n => outbox.enqueue(n, `tagihan ${n}`, { category: 'billing' }));
        for (let i = 0; i < 3; i++) await outbox.processNext();
        check('billing maks 2 pesan/hari', sent.length === 2, sent.length);
        outbox.enqueue('120363@g.us', 'alert', { category: 'alert' });
        await outbox.processNext();
        check('kuota billing habis tidak menahan alert', sent.length === 3 && sent[2].text === 'alert');
    }

    // Offline: pesan ditahan, OTP yang ditunggu gagal saat timeout, pesan kedaluwarsa dibuang
    {
        const { outbox, sent, clock, transport } = setup({ ready: false });
        outbox.enqueue('628111', 'alert saat offline', { category: 'alert' });
        const otp = outbox.enqueue('628222', 'OTP', { category: 'otp', waitForResult: true, timeoutMs: 1 });
        check('offline → processNext menunggu', (await outbox.processNext()).state === 'offline');
        await new Promise(r => setTimeout(r, 10));
        check('OTP yang ditunggu resolve false saat timeout & dibatalkan', await otp === false && outbox.stats().queued === 1);
        transport.ready = true;
        clock.t += 61 * 60 * 1000;
        const r = await outbox.processNext();
        check('alert kedaluwarsa (>60 menit) tidak dikirim', sent.length === 0 && r.state === 'idle', r.state);
    }

    // Nomor tidak terdaftar WhatsApp & transport mati (banned/logout)
    {
        const { outbox, sent, transport } = setup();
        transport.invalid.add('628000');
        const p = outbox.enqueue('628000', 'halo', { category: 'otp', waitForResult: true });
        await outbox.processNext();
        check('nomor tidak terdaftar WA tidak dikirimi', await p === false && sent.length === 0);
        transport.dead = true;
        check('saat WA logout/banned enqueue langsung false', await outbox.enqueue('628111', 'x') === false);
    }

    // Antrean penuh: billing tertua dibuang untuk memberi tempat OTP
    {
        const { outbox } = setup({ limits: { maxQueue: 2 } });
        outbox.enqueue('6281', 'tagihan 1', { category: 'billing' });
        outbox.enqueue('6282', 'tagihan 2', { category: 'billing' });
        const rejected = await outbox.enqueue('6283', 'tagihan 3', { category: 'billing' });
        check('antrean penuh menolak billing baru', rejected === false && outbox.stats().queued === 2);
        const accepted = await outbox.enqueue('6284', 'OTP', { category: 'otp' });
        check('antrean penuh tetap menerima OTP dengan membuang billing tertua', accepted === true && outbox.stats().queued === 2);
    }

    console.log(failures ? `\n${failures} FAIL` : '\nSEMUA PASS');
    process.exit(failures ? 1 : 0);
})();
