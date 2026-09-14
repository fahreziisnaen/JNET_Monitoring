/**
 * whatsappOutbox.js
 * Antrean pesan WhatsApp keluar untuk mengurangi risiko ban nomor bot (Baileys adalah klien tidak resmi):
 * satu jalur kirim, jeda acak + efek mengetik, prioritas, batas per jam/hari/penerima,
 * buang pesan kembar, dan gabung alert beruntun ke tujuan yang sama.
 */
const crypto = require('crypto');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const PRIORITY = { otp: 0, alert: 1, billing: 2 };
const TTL = { otp: 5 * 60 * 1000, alert: HOUR, billing: DAY };

function envInt(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return Number.isNaN(value) ? fallback : value;
}

function defaultLimits() {
    return {
        minDelayMs: envInt('WA_MIN_DELAY_MS', 4000),
        maxDelayMs: envInt('WA_MAX_DELAY_MS', 10000),
        hourlyLimit: envInt('WA_HOURLY_LIMIT', 60),            // semua kategori kecuali OTP
        dailyLimit: envInt('WA_DAILY_LIMIT', 400),              // semua kategori
        billingDailyLimit: envInt('WA_BILLING_DAILY_LIMIT', 200),
        perRecipientHourly: envInt('WA_PER_RECIPIENT_HOURLY', 5), // nomor perorangan
        perGroupHourly: envInt('WA_PER_GROUP_HOURLY', 20),
        dedupeWindowMs: 10 * 60 * 1000,
        maxMergeLength: 3500,
        maxQueue: 500,
    };
}

function createOutbox({ transport, now = Date.now, random = Math.random, log = console, limits = {} }) {
    const cfg = { ...defaultLimits(), ...limits };
    const queue = [];
    const sentLog = []; // { at, category, target }
    const recentKeys = new Map(); // dedupe key -> waktu enqueue
    let nextId = 1;

    const isGroup = (target) => target.endsWith('@g.us');
    const dedupeKey = (target, text) => `${target}|${crypto.createHash('sha1').update(text).digest('hex')}`;

    function settle(item, result) {
        item.waiters.forEach(resolve => resolve(result));
        item.waiters = [];
    }

    function removeFromQueue(item) {
        const index = queue.indexOf(item);
        if (index !== -1) queue.splice(index, 1);
    }

    function pruneOld() {
        const t = now();
        while (sentLog.length && t - sentLog[0].at >= DAY) sentLog.shift();
        for (const [key, at] of recentKeys) if (t - at >= cfg.dedupeWindowMs) recentKeys.delete(key);
    }

    /** Waktu (ms dari sekarang) sampai item boleh dikirim; 0 berarti boleh sekarang. */
    function throttleWait(item) {
        const t = now();
        const caps = [];
        if (item.category !== 'otp') caps.push({ window: HOUR, limit: cfg.hourlyLimit, match: () => true, exemptOtp: true });
        caps.push({ window: DAY, limit: cfg.dailyLimit, match: () => true });
        if (item.category === 'billing') caps.push({ window: DAY, limit: cfg.billingDailyLimit, match: e => e.category === 'billing' });
        caps.push({
            window: HOUR,
            limit: isGroup(item.target) ? cfg.perGroupHourly : cfg.perRecipientHourly,
            match: e => e.target === item.target,
        });

        let wait = 0;
        for (const cap of caps) {
            const hits = sentLog.filter(e => t - e.at < cap.window && (!cap.exemptOtp || e.category !== 'otp') && cap.match(e));
            if (hits.length >= cap.limit) {
                const freesAt = hits[hits.length - cap.limit].at + cap.window;
                wait = Math.max(wait, freesAt - t);
            }
        }
        return wait;
    }

    function enqueue(target, text, { category = 'alert', waitForResult = false, timeoutMs = 90 * 1000 } = {}) {
        target = String(target || '').trim();
        text = String(text || '');
        if (!target || !text || !PRIORITY.hasOwnProperty(category)) return Promise.resolve(false);
        if (transport.isDead()) return Promise.resolve(false);

        pruneOld();
        const key = dedupeKey(target, text);
        if (recentKeys.has(key)) return Promise.resolve(true); // pesan yang sama baru saja dikirim/diantrekan
        recentKeys.set(key, now());

        let item = null;
        if (category === 'alert') {
            item = queue.find(q => q.category === 'alert' && q.target === target && !q.inFlight
                && q.text.length + text.length + 2 <= cfg.maxMergeLength);
            if (item) {
                item.text += `\n\n${text}`;
                item.merged = true;
            }
        }

        if (!item) {
            if (queue.length >= cfg.maxQueue) {
                // Buang item prioritas paling rendah yang paling lama, hanya bila item baru lebih penting
                const victim = [...queue].filter(q => !q.inFlight)
                    .sort((a, b) => PRIORITY[b.category] - PRIORITY[a.category] || a.enqueuedAt - b.enqueuedAt)[0];
                if (!victim || PRIORITY[victim.category] <= PRIORITY[category]) {
                    log.error(`[WhatsApp Outbox] Antrean penuh, pesan ${category} ke ${target} ditolak.`);
                    return Promise.resolve(false);
                }
                removeFromQueue(victim);
                settle(victim, false);
            }
            item = {
                id: nextId++, target, text, category,
                enqueuedAt: now(), expiresAt: now() + TTL[category],
                waiters: [], inFlight: false, merged: false,
            };
            queue.push(item);
        }

        if (!waitForResult) return Promise.resolve(true);

        return new Promise((resolve) => {
            item.waiters.push(resolve);
            const timer = setTimeout(() => {
                item.waiters = item.waiters.filter(w => w !== resolve);
                // Batalkan agar pesan (mis. OTP) tidak terkirim terlambat setelah pengirim diberi tahu gagal
                if (!item.inFlight && !item.merged && item.waiters.length === 0) removeFromQueue(item);
                resolve(false);
            }, timeoutMs);
            timer.unref?.();
        });
    }

    /** Memproses satu pesan. Mengembalikan state dan berapa lama loop harus menunggu. */
    async function processNext() {
        const t = now();
        for (const item of [...queue]) {
            if (!item.inFlight && item.expiresAt <= t) {
                removeFromQueue(item);
                settle(item, false);
            }
        }
        if (queue.length === 0) return { state: 'idle', waitMs: 1000 };
        if (!transport.isReady()) return { state: 'offline', waitMs: 2000 };

        pruneOld();
        const ordered = [...queue].filter(q => !q.inFlight)
            .sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category] || a.enqueuedAt - b.enqueuedAt);

        let chosen = null;
        let minWait = Infinity;
        for (const item of ordered) {
            const wait = throttleWait(item);
            if (wait === 0) { chosen = item; break; }
            minWait = Math.min(minWait, wait);
        }
        if (!chosen) return { state: 'throttled', waitMs: Math.min(Math.max(minWait, 1000), HOUR) };

        chosen.inFlight = true;
        try {
            const jid = await transport.resolveJid(chosen.target);
            if (!jid) {
                log.error(`[WhatsApp Outbox] ${chosen.target} tidak terdaftar di WhatsApp, pesan dibatalkan.`);
                removeFromQueue(chosen);
                settle(chosen, false);
                return { state: 'invalid', waitMs: 0 };
            }
            await transport.simulateTyping(jid, chosen.text);
            await transport.send(jid, chosen.text);
            sentLog.push({ at: now(), category: chosen.category, target: chosen.target });
            removeFromQueue(chosen);
            settle(chosen, true);
            const delay = cfg.minDelayMs + Math.floor(random() * (cfg.maxDelayMs - cfg.minDelayMs));
            return { state: 'sent', waitMs: delay };
        } catch (error) {
            log.error(`[WhatsApp Outbox] Gagal mengirim ke ${chosen.target}: ${error.message || error}`);
            removeFromQueue(chosen);
            settle(chosen, false);
            return { state: 'error', waitMs: cfg.maxDelayMs };
        }
    }

    let running = false;
    async function start() {
        if (running) return;
        running = true;
        while (running) {
            let result;
            try {
                result = await processNext();
            } catch (error) {
                log.error('[WhatsApp Outbox] Loop error:', error.message || error);
                result = { waitMs: 5000 };
            }
            await new Promise(resolve => setTimeout(resolve, result.waitMs).unref?.());
        }
    }

    function stop() {
        running = false;
    }

    function stats() {
        pruneOld();
        const t = now();
        const byCategory = { otp: 0, alert: 0, billing: 0 };
        queue.forEach(q => { byCategory[q.category]++; });
        return {
            queued: queue.length,
            queuedByCategory: byCategory,
            sentLastHour: sentLog.filter(e => t - e.at < HOUR).length,
            sentToday: sentLog.length,
            limits: { hourly: cfg.hourlyLimit, daily: cfg.dailyLimit, billingDaily: cfg.billingDailyLimit },
        };
    }

    return { enqueue, processNext, start, stop, stats };
}

module.exports = { createOutbox };
