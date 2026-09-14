const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const pool = require('../config/database');
const { createOutbox } = require('./whatsappOutbox');

let sock = null;
let isConnected = false;
let qrString = null;
// connecting | open | reconnecting | logged_out | banned | replaced
let connectionStatus = 'connecting';
let reconnectAttempts = 0;
let reconnectTimer = null;

// Status yang tidak boleh reconnect otomatis: login ulang berulang-ulang justru memicu deteksi bot
const TERMINAL_STATUS = {
    [DisconnectReason.loggedOut]: 'logged_out',
    [DisconnectReason.forbidden]: 'banned',
    [DisconnectReason.connectionReplaced]: 'replaced',
    [DisconnectReason.badSession]: 'logged_out',
};

const JID_CACHE_MS = 24 * 60 * 60 * 1000;
const jidCache = new Map(); // nomor -> { jid|null, at }

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const outbox = createOutbox({
    transport: {
        isReady: () => sock !== null && isConnected,
        isDead: () => ['logged_out', 'banned', 'replaced'].includes(connectionStatus),
        async resolveJid(target) {
            if (target.endsWith('@g.us')) return target;
            const number = target.replace(/\D/g, '');
            if (!number) return null;
            const cached = jidCache.get(number);
            if (cached && Date.now() - cached.at < JID_CACHE_MS) return cached.jid;
            // Jangan kirim ke nomor yang tidak terdaftar WA: sinyal kuat akun spam
            const [result] = (await sock.onWhatsApp(number)) || [];
            const jid = result?.exists ? result.jid : null;
            jidCache.set(number, { jid, at: Date.now() });
            return jid;
        },
        async simulateTyping(jid, text) {
            try {
                await sock.sendPresenceUpdate('composing', jid);
                await sleep(Math.min(5000, 1000 + text.length * 30) + Math.floor(Math.random() * 800));
                await sock.sendPresenceUpdate('paused', jid);
            } catch {
                // Presence hanya kosmetik; jangan gagalkan pengiriman
            }
        },
        async send(jid, text) {
            await sock.sendMessage(jid, { text });
        },
    },
});
outbox.start();

function scheduleReconnect() {
    if (reconnectTimer) return;
    // Backoff eksponensial + jitter: 5 dtk, 10, 20, ... maks 5 menit
    const delay = Math.min(5 * 60 * 1000, 5000 * 2 ** reconnectAttempts) + Math.floor(Math.random() * 3000);
    reconnectAttempts++;
    connectionStatus = 'reconnecting';
    console.error(`[WhatsApp] Reconnect percobaan ${reconnectAttempts} dalam ${Math.round(delay / 1000)} detik`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startWhatsApp().catch(err => {
            console.error('[WhatsApp] Gagal reconnect:', err.message);
            scheduleReconnect();
        });
    }, delay);
}

async function startWhatsApp() {
    console.log('[WhatsApp] Memulai koneksi ke WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    if (process.env.DEBUG_API === 'true') {
        console.log(`[WhatsApp] Menggunakan Baileys v${version.join('.')} (Versi Terbaru: ${isLatest ? 'Ya' : 'Tidak'})`);
    }

    // Pastikan hanya ada satu socket aktif; socket ganda terlihat seperti login berulang
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.end(undefined); } catch {}
        sock = null;
    }

    const currentSock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false, // Kita manual pakai qrcode-terminal
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
    });
    sock = currentSock;
    connectionStatus = 'connecting';

    currentSock.ev.on('creds.update', saveCreds);

    currentSock.ev.on('connection.update', (update) => {
        if (sock !== currentSock) return; // event dari socket lama
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrString = qr;
            console.log('[WhatsApp] Pindai QR Code ini dengan WhatsApp di HP Anda:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            qrString = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.error('[WhatsApp] Koneksi ditutup. Kode:', statusCode, 'Alasan:', lastDisconnect?.error?.message);

            if (TERMINAL_STATUS[statusCode]) {
                connectionStatus = TERMINAL_STATUS[statusCode];
                console.error(`[WhatsApp] Status ${connectionStatus}: reconnect otomatis dihentikan. Reset sesi dari Pengaturan lalu pindai QR dengan nomor yang sehat.`);
                return;
            }
            if (statusCode === DisconnectReason.restartRequired) {
                // Normal setelah QR dipindai
                startWhatsApp().catch(err => console.error('[WhatsApp] Gagal restart:', err.message));
                return;
            }
            scheduleReconnect();
        } else if (connection === 'open') {
            isConnected = true;
            connectionStatus = 'open';
            reconnectAttempts = 0;
            qrString = null; // Reset QR setelah berhasil konek
            console.log('[WhatsApp] Koneksi WhatsApp berhasil!');
        }
    });
}

function isWhatsAppConnected() {
    return sock !== null && isConnected;
}

/**
 * Mengirim pesan lewat antrean anti-ban.
 * @param {string} number nomor (62xxx) atau JID grup (xxx@g.us)
 * @param {object} options category: 'otp' | 'alert' | 'billing'; waitForResult: tunggu sampai benar-benar terkirim
 * @returns {Promise<boolean>} tanpa waitForResult: true bila diterima antrean
 */
async function sendWhatsAppMessage(number, message, { category = 'alert', waitForResult = false, timeoutMs } = {}) {
    if (!number) return false;
    const accepted = outbox.enqueue(String(number), message, { category, waitForResult, timeoutMs });
    if (!waitForResult && connectionStatus !== 'open') {
        console.warn(`[WhatsApp] Koneksi belum siap (${connectionStatus}); pesan ke ${number} ditahan di antrean.`);
    }
    return accepted;
}

function getWhatsAppStatus() {
    return {
        status: connectionStatus,
        connected: isWhatsAppConnected(),
        reconnectAttempts,
        outbox: outbox.stats(),
    };
}

/**
 * Helper function untuk mendapatkan WhatsApp target (group atau individual) dari workspace
 * Prioritas: Group JID > Owner WhatsApp Number
 */
async function getWorkspaceWhatsAppTarget(workspaceId) {
    const [workspaces] = await pool.query(
        `SELECT w.whatsapp_group_id, w.whatsapp_bot_enabled, u.whatsapp_number
         FROM workspaces w
         LEFT JOIN users u ON w.owner_id = u.id
         WHERE w.id = ?`,
        [workspaceId]
    );

    if (workspaces.length === 0) {
        return null;
    }

    const workspace = workspaces[0];

    // Jika fitur alert bot dinonaktifkan untuk workspace ini, jangan kirim pesan
    if (!workspace.whatsapp_bot_enabled) {
        return null;
    }

    // Prioritas: Group JID > Owner WhatsApp Number
    if (workspace.whatsapp_group_id) {
        return workspace.whatsapp_group_id;
    } else if (workspace.whatsapp_number) {
        return workspace.whatsapp_number;
    }

    return null;
}

async function getParticipatingGroups() {
    if (!sock) return [];
    try {
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups).map(group => ({
            id: group.id,
            subject: group.subject
        }));
    } catch (error) {
        console.error("[WhatsApp] Gagal mengambil daftar grup:", error);
        return [];
    }
}

function getLatestQR() {
    return qrString;
}

module.exports = { startWhatsApp, sendWhatsAppMessage, isWhatsAppConnected, getWorkspaceWhatsAppTarget, getParticipatingGroups, getLatestQR, getWhatsAppStatus };
