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
                'SELECT id, username, display_name, profile_picture_url, workspace_id, whatsapp_number FROM users WHERE id = ?',
                [decoded.id]
            );

            if (users.length === 0) {
                return res.status(401).json({ message: 'Tidak terotorisasi, user tidak ditemukan.' });
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
            
            req.user = {
                id: dbUser.id,
                username: dbUser.username,
                displayName: dbUser.display_name,
                profile_picture_url: profilePictureUrl,
                workspace_id: dbUser.workspace_id,
                whatsapp_number: dbUser.whatsapp_number,
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

module.exports = { protect };