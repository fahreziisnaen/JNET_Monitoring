const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const pool = require('../config/database');

let sock = null;

async function startWhatsApp(onMessageCallback) {
    console.log('[WhatsApp] Memulai koneksi...');
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msgInfo = m.messages[0];
        if (msgInfo.key.fromMe || !msgInfo.message) return;

        const remoteJid = msgInfo.key.remoteJid;
        const isGroup = remoteJid.includes('@g.us');
        const from = remoteJid.split('@')[0];
        const messageText = msgInfo.message.conversation || msgInfo.message.extendedTextMessage?.text || '';

        // Log semua pesan masuk untuk debugging (terutama untuk mendapatkan Group JID)
        if (isGroup) {
            // Ini adalah pesan dari group
            console.log(`[WhatsApp] ========================================`);
            console.log(`[WhatsApp] Pesan dari GROUP WhatsApp`);
            console.log(`[WhatsApp] Group JID lengkap: ${remoteJid}`);
            console.log(`[WhatsApp] Pengirim: ${from}`);
            console.log(`[WhatsApp] Pesan: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
            console.log(`[WhatsApp] ========================================`);
        } else {
            // Ini adalah pesan dari individual
            console.log(`[WhatsApp] Pesan dari INDIVIDUAL: ${remoteJid}`);
        }

        // Handle command khusus untuk mendapatkan Group JID
        if (isGroup && messageText.trim() === '.getgroupid') {
            try {
                // Cari workspace berdasarkan group JID yang sudah ada atau dari pengirim
                let workspaceId = null;
                const [workspacesByGroup] = await pool.query(
                    `SELECT w.id, w.name 
                     FROM workspaces w
                     WHERE w.whatsapp_group_id = ? AND w.whatsapp_bot_enabled = TRUE`,
                    [remoteJid]
                );
                
                if (workspacesByGroup.length > 0) {
                    workspaceId = workspacesByGroup[0].id;
                } else {
                    // Jika tidak ditemukan berdasarkan group JID, cari dari pengirim
                    const [workspacesByUser] = await pool.query(
                        `SELECT w.id, w.name 
                         FROM workspaces w
                         JOIN users u ON w.owner_id = u.id
                         WHERE u.whatsapp_number = ? AND w.whatsapp_bot_enabled = TRUE
                         LIMIT 1`,
                        [from]
                    );
                    
                    if (workspacesByUser.length > 0) {
                        workspaceId = workspacesByUser[0].id;
                    }
                }
                
                const message = `📋 *Group JID untuk workspace ini:*\n\n\`${remoteJid}\`\n\n✅ *Cara Update Group ID:*\n\n1. Buka halaman *Settings* di dashboard web\n2. Scroll ke bagian *Bot WhatsApp Interaktif*\n3. Salin Group ID di atas dan paste ke kolom *WhatsApp Group ID*\n4. Klik tombol *Simpan*\n\nSetelah disimpan, semua notifikasi akan dikirim ke group ini.`;
                
                await sock.sendMessage(remoteJid, { text: message });
            } catch (error) {
                console.error("[Bot] Gagal mengirim Group JID:", error);
            }
            return;
        }

        if (onMessageCallback && messageText && messageText.startsWith('.')) {
            try {
                // Untuk group, kita perlu cari workspace berdasarkan group JID atau dari pengirim
                if (isGroup) {
                    // Cari workspace yang punya group JID ini
                    const [workspaces] = await pool.query(
                        `SELECT w.*, u.*, w.name as workspace_name, w.whatsapp_bot_enabled 
                         FROM workspaces w 
                         LEFT JOIN users u ON w.owner_id = u.id 
                         WHERE w.whatsapp_group_id = ? AND w.whatsapp_bot_enabled = TRUE`,
                        [remoteJid]
                    );
                    
                    if (workspaces.length > 0) {
                        const workspace = workspaces[0];
                        // Buat user object untuk command handler
                        const user = {
                            ...workspace,
                            workspace_id: workspace.id,
                            workspace_name: workspace.workspace_name || workspace.name
                        };
                        onMessageCallback(messageText, remoteJid, user);
                    } else {
                        // Jika workspace belum di-set, coba cari dari pengirim
                        const [users] = await pool.query(
                            `SELECT u.*, w.name as workspace_name, w.whatsapp_bot_enabled 
                             FROM users u 
                             JOIN workspaces w ON u.workspace_id = w.id 
                             WHERE u.whatsapp_number = ? AND w.whatsapp_bot_enabled = TRUE`, 
                            [from]
                        );
                        
                        if (users.length > 0) {
                            const user = users[0];
                            onMessageCallback(messageText, remoteJid, user);
                        }
                    }
                } else {
                    // Pesan dari individual user (seperti sebelumnya)
                    const [users] = await pool.query(
                        `SELECT u.*, w.name as workspace_name, w.whatsapp_bot_enabled 
                         FROM users u 
                         JOIN workspaces w ON u.workspace_id = w.id 
                         WHERE u.whatsapp_number = ? AND w.whatsapp_bot_enabled = TRUE`, 
                        [from]
                    );
                    
                    if (users.length > 0) {
                        const user = users[0];
                        onMessageCallback(messageText, from, user);
                    }
                }
            } catch (error) {
                console.error("[Bot] Gagal memproses pesan masuk:", error);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) {
            console.log('[WhatsApp] Pindai QR Code ini dengan WhatsApp di HP Anda:');
            qrcode.generate(qr, { small: true });
        }

        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[WhatsApp] Koneksi ditutup, mencoba menghubungkan kembali:', shouldReconnect);
            if(shouldReconnect) {
                startWhatsApp(onMessageCallback);
            }
        } else if(connection === 'open') {
            console.log('[WhatsApp] Koneksi WhatsApp berhasil!');
        }
    });
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
    } catch(error) {
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

module.exports = { startWhatsApp, sendWhatsAppMessage, getWorkspaceWhatsAppTarget };