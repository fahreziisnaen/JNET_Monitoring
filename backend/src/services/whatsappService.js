const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const pool = require('../config/database');

let sock = null;
let isConnected = false;
let qrString = null;

async function startWhatsApp() {
    console.log('[WhatsApp] Memulai koneksi ke WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    if (process.env.DEBUG_API === 'true') {
        console.log(`[WhatsApp] Menggunakan Baileys v${version.join('.')} (Versi Terbaru: ${isLatest ? 'Ya' : 'Tidak'})`);
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false, // Kita manual pakai qrcode-terminal
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrString = qr;
            console.log('[WhatsApp] Pindai QR Code ini dengan WhatsApp di HP Anda:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[WhatsApp] Koneksi ditutup, mencoba menghubungkan kembali:', shouldReconnect);
            console.log('[WhatsApp] Alasan Putus (Error):', lastDisconnect?.error?.message, lastDisconnect?.error?.stack);

            if (shouldReconnect) {
                // Add a delay to prevent tight infinite synchronous loops that crash the app
                setTimeout(() => {
                    startWhatsApp();
                }, 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrString = null; // Reset QR setelah berhasil konek
            console.log('[WhatsApp] Koneksi WhatsApp berhasil!');
        }
    });
}

function isWhatsAppConnected() {
    return sock !== null && isConnected;
}

async function sendWhatsAppMessage(number, message) {
    if (!isWhatsAppConnected()) {
        console.warn(`[WhatsApp] Peringatan: Koneksi WhatsApp belum siap atau terputus. Pesan ke ${number} diabaikan.`);
        return false;
    }

    // Cek apakah ini group JID (berakhiran @g.us) atau individual number
    let jid;
    if (number.includes('@g.us')) {
        // Ini adalah group JID, gunakan langsung
        jid = number;
    } else {
        // Ini adalah individual number, tambahkan @s.whatsapp.net
        jid = `${number}@s.whatsapp.net`;
    }

    try {
        await sock.sendMessage(jid, { text: message });
        return true;
    } catch (error) {
        console.error(`[WhatsApp] Gagal mengirim pesan ke ${number}: `, error.message || error);
        // Jangan throw error agar tidak mengganggu proses utama pemanggil (seperti cron jobs)
        return false;
    }
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

module.exports = { startWhatsApp, sendWhatsAppMessage, getWorkspaceWhatsAppTarget, isWhatsAppConnected, getParticipatingGroups, getLatestQR };