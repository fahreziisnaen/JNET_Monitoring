const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const { sendWhatsAppMessage, isWhatsAppConnected, getParticipatingGroups, getLatestQR } = require('../services/whatsappService');
const { generateSingleReport } = require('../bot/reportGenerator');

// Hardcoded Super Admin IDs (Owner)
const SUPER_ADMIN_IDS = process.env.SUPER_ADMIN_IDS
    ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
    : [1];

exports.toggleBotStatus = async (req, res) => {
    // Security Check: Hanya Super Admin
    if (!SUPER_ADMIN_IDS.includes(req.user.id)) {
        return res.status(403).json({
            message: 'Akses ditolak. Fitur ini hanya untuk Super Admin (Pemilik Server) karena berdampak global ke semua workspace.'
        });
    }

    const { isEnabled } = req.body;
    const workspaceId = req.user.workspace_id;
    const { whatsapp_number: waNumber, displayName } = req.user;

    try {
        await pool.query('UPDATE workspaces SET whatsapp_bot_enabled = ? WHERE id = ?', [isEnabled, workspaceId]);

        if (waNumber) {
            const statusText = isEnabled ? 'diaktifkan' : 'dinonaktifkan';
            const message = `Halo ${displayName}, Bot WhatsApp untuk workspace Anda telah berhasil *${statusText}*.`;
            try {
                await sendWhatsAppMessage(waNumber, message);
            } catch (waError) {
                console.error(`[Bot Toggle] Gagal mengirim notifikasi WA ke ${waNumber}:`, waError);
            }
        }

        res.status(200).json({ message: `Bot WhatsApp telah ${isEnabled ? 'diaktifkan' : 'dinonaktifkan'}.` });
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengubah status bot.' });
    }
};


exports.getQRStatus = async (req, res) => {
    try {
        const connected = isWhatsAppConnected();
        const qr = getLatestQR();
        res.status(200).json({
            connected,
            qr: qr // String QR mentah dari Baileys
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengecek status QR.' });
    }
};

exports.requestResetOtp = async (req, res) => {
    // Security Check: Hanya Super Admin
    if (!SUPER_ADMIN_IDS.includes(req.user.id)) {
        return res.status(403).json({
            message: 'Akses ditolak. Fitur ini hanya untuk Super Admin (Pemilik Server).'
        });
    }

    const workspaceId = req.user.workspace_id;
    const userId = req.user.id;
    const waNumber = req.user.whatsapp_number;
    const authPath = path.join(process.cwd(), 'whatsapp_auth_info');

    try {
        const hasSession = fs.existsSync(path.join(authPath, 'creds.json'));
        const isActive = isWhatsAppConnected();

        // Jika tidak ada sesi atau WA tidak aktif/error, tidak butuh OTP
        if (!hasSession || !isActive || !waNumber) {
            return res.status(200).json({
                otpRequired: false,
                message: 'WhatsApp tidak aktif atau belum terdaftar. Reset dapat dilakukan langsung.'
            });
        }

        // Jika aktif, kirim OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

        await pool.query(
            'INSERT INTO login_otps (user_id, otp_code, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp_code = VALUES(otp_code), expires_at = VALUES(expires_at)',
            [userId, otp, expiresAt]
        );

        await sendWhatsAppMessage(waNumber, `⚠️ *Peringatan Keamanan JNET*\n\nSeseorang mencoba me-reset sesi WhatsApp Anda. Jika ini Anda, gunakan kode OTP berikut:\n\n*${otp}*\n\nKode ini berlaku 5 menit.`);

        res.status(200).json({
            otpRequired: true,
            message: 'Kode keamanan telah dikirim ke WhatsApp Anda.'
        });

    } catch (error) {
        console.error("[Request Reset OTP] Error:", error);
        res.status(500).json({ message: 'Gagal memproses permintaan reset.' });
    }
};

exports.resetSession = async (req, res) => {
    // Security Check: Hanya Super Admin
    if (!SUPER_ADMIN_IDS.includes(req.user.id)) {
        return res.status(403).json({
            message: 'Akses ditolak. Fitur ini hanya untuk Super Admin (Pemilik Server).'
        });
    }

    const { otp } = req.body;
    const userId = req.user.id;
    const authPath = path.join(process.cwd(), 'whatsapp_auth_info');

    try {
        const hasSession = fs.existsSync(path.join(authPath, 'creds.json'));
        const isActive = isWhatsAppConnected();

        // Verifikasi OTP jika masih ada sesi aktif
        if (hasSession && isActive) {
            if (!otp) {
                return res.status(400).json({ message: 'Kode OTP diperlukan untuk me-reset sesi aktif.' });
            }

            const [rows] = await pool.query(
                'SELECT * FROM login_otps WHERE user_id = ? AND otp_code = ? AND expires_at > NOW()',
                [userId, otp]
            );

            if (rows.length === 0) {
                return res.status(400).json({ message: 'Kode OTP salah atau sudah kedaluwarsa.' });
            }

            // Hapus OTP setelah digunakan
            await pool.query('DELETE FROM login_otps WHERE user_id = ?', [userId]);
        }

        console.log(`[WhatsApp Reset] Membersihkan sesi di: ${authPath}`);

        // Beri respon sukses TERLEBIH DAHULU
        res.status(200).json({ message: 'Sesi berhasil dibersihkan. Aplikasi akan segera restart.' });

        // Proses cleanup setelah respon dikirim
        setTimeout(() => {
            if (fs.existsSync(authPath)) {
                // Hanya hapus isi folder, bukan foldernya
                const files = fs.readdirSync(authPath);
                for (const file of files) {
                    const curPath = path.join(authPath, file);
                    if (fs.lstatSync(curPath).isDirectory()) {
                        fs.rmSync(curPath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(curPath);
                    }
                }
                console.log('[WhatsApp Reset] Isi folder auth berhasil dihapus.');
            }

            // Trigger restart untuk nodemon (Development) dengan cara menyentuh file watched
            const serverPath = path.join(process.cwd(), 'server.js');
            if (fs.existsSync(serverPath)) {
                const now = new Date();
                fs.utimesSync(serverPath, now, now);
                console.log('[WhatsApp Reset] Menghubungi nodemon via touch server.js');
            }

            // Tetap exit untuk PM2 (Production)
            console.log('[WhatsApp Reset] Restarting process...');
            setTimeout(() => {
                process.exit(0);
            }, 500);
        }, 1000);

    } catch (error) {
        console.error("[WhatsApp Reset] Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Gagal me-reset sesi WhatsApp.' });
        }
    }
};

exports.getGroups = async (req, res) => {
    try {
        if (!isWhatsAppConnected()) {
            return res.status(200).json([]);
        }
        const groups = await getParticipatingGroups();
        res.status(200).json(groups);
    } catch (error) {
        console.error("[Bot Controller] Gagal ambil grup:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar grup.' });
    }
};