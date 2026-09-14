/**
 * rateLimiter.js
 * Pembatas percobaan in-memory berbasis jendela waktu tetap per key.
 * Hitungan hilang saat proses restart; cukup untuk satu proses backend (pm2 fork mode).
 */

function createRateLimiter({ windowMs, max, now = Date.now }) {
    const entries = new Map(); // key -> { count, windowStart }

    function current(key) {
        const entry = entries.get(key);
        if (!entry) return null;
        if (now() - entry.windowStart >= windowMs) {
            entries.delete(key);
            return null;
        }
        return entry;
    }

    function check(key) {
        const entry = current(key);
        if (!entry || entry.count < max) {
            return { allowed: true, remaining: max - (entry ? entry.count : 0), retryAfterMs: 0 };
        }
        return { allowed: false, remaining: 0, retryAfterMs: entry.windowStart + windowMs - now() };
    }

    function hit(key) {
        const entry = current(key) || { count: 0, windowStart: now() };
        entry.count++;
        entries.set(key, entry);
        return { remaining: Math.max(0, max - entry.count) };
    }

    function reset(key) {
        entries.delete(key);
    }

    // Bersihkan entry kedaluwarsa agar Map tidak tumbuh terus
    const sweeper = setInterval(() => {
        for (const key of entries.keys()) current(key);
    }, Math.max(windowMs, 60_000));
    sweeper.unref();

    return { check, hit, reset };
}

function retryMessage(retryAfterMs) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    return `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`;
}

module.exports = { createRateLimiter, retryMessage };
