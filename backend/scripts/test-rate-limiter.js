// Uji util rate limiter (in-memory, jendela waktu tetap per key).
// Jalankan: node scripts/test-rate-limiter.js
const { createRateLimiter } = require('../src/utils/rateLimiter');

let failures = 0;
function check(label, ok, extra = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` (${extra})` : ''}`);
    if (!ok) failures++;
}

let now = 1_000_000;
const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => now });

check('key baru tidak diblokir', limiter.check('a').allowed === true);
limiter.hit('a'); limiter.hit('a');
check('2 dari 3 masih boleh', limiter.check('a').allowed === true);
limiter.hit('a');
const blocked = limiter.check('a');
check('ke-3 mencapai batas → diblokir', blocked.allowed === false);
check('retryAfter dihitung dari awal jendela', blocked.retryAfterMs === 60_000, blocked.retryAfterMs);
check('key lain tidak terpengaruh', limiter.check('b').allowed === true);

now += 30_000;
check('masih diblokir di tengah jendela', limiter.check('a').allowed === false);
check('retryAfter berkurang', limiter.check('a').retryAfterMs === 30_000, limiter.check('a').retryAfterMs);

now += 30_001;
check('jendela habis → boleh lagi', limiter.check('a').allowed === true);

limiter.hit('c'); limiter.hit('c'); limiter.hit('c');
limiter.reset('c');
check('reset (mis. setelah login sukses) membuka blokir', limiter.check('c').allowed === true);

const r = limiter.hit('d');
check('hit mengembalikan sisa kuota', r.remaining === 2, r.remaining);

console.log(failures ? `\n${failures} FAIL` : '\nSEMUA PASS');
process.exit(failures ? 1 : 0);
