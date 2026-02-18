const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const pool = require('../config/database');

let sock = null;
let isConnected = false;
let qrString = null;

async function startWhatsApp() {
    console.log('[WhatsApp] Memulai koneksi...');
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
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
            if (shouldReconnect) {
                startWhatsApp();
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
    if (!sock) throw new Error('Koneksi WhatsApp belum siap.');

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
    } catch (error) {
        console.error(`[WhatsApp] Gagal mengirim pesan ke ${number}: `, error);
        throw error;
    }
}

/**
 * Helper function untuk mendapatkan WhatsApp target (group atau individual) dari workspace
 * Prioritas: Group JID > Owner WhatsApp Number
 */
async function getWorkspaceWhatsAppTarget(workspaceId) {
    const [workspaces] = await pool.query(
        `SELECT w.whatsapp_group_id, u.whatsapp_number 
         FROM workspaces w 
         LEFT JOIN users u ON w.owner_id = u.id 
         WHERE w.id = ?`,
        [workspaceId]
    );

    if (workspaces.length === 0) {
        return null;
    }

    const workspace = workspaces[0];

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