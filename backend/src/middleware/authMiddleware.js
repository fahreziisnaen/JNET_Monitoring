const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const protect = async (req, res, next) => {
    let token;

    // Cek cookie terlebih dahulu
    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } else if (req.headers.cookie) {
        // Fallback: parse cookie manual jika cookie parser tidak bekerja
        const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
            const [key, value] = cookie.trim().split('=');
            if (key && value) {
                acc[key] = value;
            }
            return acc;
        }, {});
        token = cookies.token;
    } else if (req.headers.authorization) {
        // Fallback: cek Authorization header (Bearer token)
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Hanya log di development atau jika DEBUG_AUTH di-set
            if (process.env.NODE_ENV === 'development' && process.env.DEBUG_AUTH === 'true') {
                console.log(`[Auth Middleware] Token ditemukan dan valid untuk user ${decoded.id}`);
            }
            const [users] = await pool.query(
                'SELECT id, username, display_name, profile_picture_url, workspace_id, whatsapp_number, role FROM users WHERE id = ?',
                [decoded.id]
            );

            if (users.length === 0) {
                return res.status(401).json({ message: 'Tidak terotorisasi, user tidak ditemukan.' });
            }

            // Verify if the session still exists in database (allows revoking tokens on logout)
            const [sessions] = await pool.query(
                'SELECT id FROM user_sessions WHERE token_id = ? AND user_id = ?',
                [decoded.jti, decoded.id]
            );

            if (sessions.length === 0) {
                console.warn(`[Auth Middleware] Session ${decoded.jti} not found in database. Token revoked.`);
                return res.status(401).json({ message: 'Sesi telah berakhir atau dikeluarkan. Silakan login kembali.' });
            }

            let dbUser = users[0];

            // Safeguard: Jika user tidak punya workspace_id, buat workspace otomatis
            if (!dbUser.workspace_id) {
                console.log(`[Auth Middleware] User ${dbUser.id} tidak punya workspace_id, membuat workspace otomatis...`);
                try {
                    const [wsResult] = await pool.query(
                        'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
                        [`${dbUser.display_name || dbUser.username}'s Workspace`, dbUser.id]
                    );
                    await pool.query('UPDATE users SET workspace_id = ? WHERE id = ?', [wsResult.insertId, dbUser.id]);
                    // Update dbUser object dengan workspace_id yang baru dibuat
                    dbUser.workspace_id = wsResult.insertId;
                    console.log(`[Auth Middleware] Workspace ${wsResult.insertId} berhasil dibuat untuk user ${dbUser.id}`);
                } catch (error) {
                    console.error(`[Auth Middleware] Error membuat workspace untuk user ${dbUser.id}:`, error);
                    // Jika gagal membuat workspace, coba query lagi dari database
                    const [updatedUsers] = await pool.query('SELECT workspace_id FROM users WHERE id = ?', [dbUser.id]);
                    if (updatedUsers[0]?.workspace_id) {
                        dbUser.workspace_id = updatedUsers[0].workspace_id;
                    }
                }
            }

            // Set default avatar jika tidak ada
            const profilePictureUrl = dbUser.profile_picture_url || '/public/uploads/avatars/default.jpg';

            // Tentukan apakah user adalah Super Admin
            const superAdminIds = process.env.SUPER_ADMIN_IDS
                ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
                : [1];
            const isSuperAdmin = superAdminIds.includes(dbUser.id);

            // Tentukan apakah user adalah owner dari workspace-nya
            const [wsOwnerInfo] = await pool.query('SELECT owner_id FROM workspaces WHERE id = ?', [dbUser.workspace_id]);
            const isOwner = wsOwnerInfo.length > 0 && wsOwnerInfo[0].owner_id === dbUser.id;

            req.user = {
                id: dbUser.id,
                username: dbUser.username,
                displayName: dbUser.display_name,
                profile_picture_url: profilePictureUrl,
                workspace_id: dbUser.workspace_id,
                whatsapp_number: dbUser.whatsapp_number,
                role: dbUser.role || 'user',
                is_owner: isOwner,
                is_super_admin: isSuperAdmin,
                jti: decoded.jti
            };

            await pool.query(
                'UPDATE user_sessions SET last_seen = NOW() WHERE token_id = ?',
                [decoded.jti]
            );

            next();
        } catch (error) {
            console.error(error);
            return res.status(401).json({ message: 'Tidak terotorisasi, token tidak valid.' });
        }
    }

    if (!token) {
        // Log untuk debugging
        console.warn('[Auth Middleware] Tidak ada token ditemukan.');
        console.warn('[Auth Middleware] Cookies object:', req.cookies);
        console.warn('[Auth Middleware] Headers cookie:', req.headers.cookie);
        console.warn('[Auth Middleware] Authorization header:', req.headers.authorization);
        console.warn('[Auth Middleware] Request URL:', req.url);
        console.warn('[Auth Middleware] Request method:', req.method);
        console.warn('[Auth Middleware] Request origin:', req.headers.origin);
        console.warn('[Auth Middleware] Request host:', req.headers.host);
        return res.status(401).json({ message: 'Tidak terotorisasi, tidak ada token.' });
    }
};

const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Akses ditolak. Fitur ini hanya untuk Admin.' });
    }
};

const authorizeSuperAdmin = (req, res, next) => {
    // Hardcoded Super Admin IDs (Owner)
    // Ambil dari environment variable atau default ke ID 1
    const superAdminIds = process.env.SUPER_ADMIN_IDS
        ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
        : [1];

    if (req.user && superAdminIds.includes(req.user.id)) {
        next();
    } else {
        res.status(403).json({ message: 'Akses ditolak. Fitur ini hanya untuk Super Admin (Pemilik Server).' });
    }
};

module.exports = { protect, authorizeAdmin, authorizeSuperAdmin };