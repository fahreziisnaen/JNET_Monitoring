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
            // Coba verifikasi sebagai JWT biasa
            let decoded;
            let isApiKey = false;
            let dbUser = null;

            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET);
            } catch (jwtError) {
                // Jika gagal verify JWT, cek apakah token tersebut adalah API Key di database
                const [apiKeys] = await pool.query(
                    'SELECT id, workspace_id, name FROM api_keys WHERE key_string = ?',
                    [token]
                );

                if (apiKeys.length > 0) {
                    isApiKey = true;
                    // Mock dbUser untuk API Key (diperlakukan seperti admin di workspace tersebut)
                    dbUser = {
                        id: -1, // ID khusus untuk Service Account/API Key
                        username: `api_key_${apiKeys[0].name}`,
                        display_name: `Service Account (${apiKeys[0].name})`,
                        workspace_id: apiKeys[0].workspace_id,
                        role: 'admin',
                        is_owner: false,
                        is_super_admin: false,
                        jti: `apikey_${apiKeys[0].id}`
                    };
                } else {
                    // Jika bukan JWT valid dan bukan API key, kembalikan error JWT
                    throw jwtError;
                }
            }

            if (!isApiKey) {
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
                console.log(`[Auth Debug] Checking session for user ${decoded.id}, jti: ${decoded.jti}, url: ${req.url}`);
                const [sessions] = await pool.query(
                    'SELECT id, token_id, user_agent, ip_address FROM user_sessions WHERE token_id = ? AND user_id = ?',
                    [decoded.jti, decoded.id]
                );

                if (sessions.length === 0) {
                    // Debug: tampilkan semua session yang ada untuk user ini
                    const [allSessions] = await pool.query(
                        'SELECT id, token_id, user_agent, ip_address, created_at FROM user_sessions WHERE user_id = ?',
                        [decoded.id]
                    );
                    console.warn(`[Auth Middleware] Session ${decoded.jti} not found in database for user ${decoded.id}. Token revoked.`);
                    console.warn(`[Auth Middleware] Available sessions for user ${decoded.id}:`, allSessions.map(s => ({ id: s.id, token_id: s.token_id, created_at: s.created_at })));
                    return res.status(401).json({ message: 'Sesi telah berakhir atau dikeluarkan. Silakan login kembali.' });
                }
                console.log(`[Auth Debug] Session found for user ${decoded.id}, session id: ${sessions[0].id}`);

                dbUser = users[0];

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

                // Tentukan apakah user adalah Super Admin
                const superAdminIds = process.env.SUPER_ADMIN_IDS
                    ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
                    : [1];
                dbUser.is_super_admin = superAdminIds.includes(dbUser.id);

                // Tentukan apakah user adalah owner dari workspace-nya
                const [wsOwnerInfo] = await pool.query('SELECT owner_id FROM workspaces WHERE id = ?', [dbUser.workspace_id]);
                dbUser.is_owner = wsOwnerInfo.length > 0 && wsOwnerInfo[0].owner_id === dbUser.id;
                dbUser.jti = decoded.jti;
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
                role: dbUser.role || 'user',
                is_owner: dbUser.is_owner,
                is_super_admin: dbUser.is_super_admin,
                jti: dbUser.jti
            };

            // --- SUPER ADMIN WORKSPACE OVERRIDE ---
            // If the user is a superadmin, and explicitly passed a workspaceId in the body or query,
            // temporarily override their active workspace context just for this request.
            // This enables cross-workspace NOC actions seamlessly.
            if (req.user.is_super_admin) {
                const targetWorkspaceId = (req.body && req.body.workspaceId) || (req.query && req.query.workspaceId);
                if (targetWorkspaceId) {
                    req.user.workspace_id = parseInt(targetWorkspaceId, 10);
                }
            }

            // Update session last seen is only for JWT users, not API keys
            if (!isApiKey) {
                await pool.query(
                    'UPDATE user_sessions SET last_seen = NOW() WHERE token_id = ?',
                    [dbUser.jti]
                );
            }

            next();
        } catch (error) {
            // Distinguish antara JWT error dan DB/server error
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
                console.warn('[Auth Middleware] Token tidak valid:', error.message);
                return res.status(401).json({ message: 'Tidak terotorisasi, token tidak valid.' });
            }
            
            // DB error (ECONNREFUSED, timeout, dll) → jangan kirim 401 karena token mungkin valid
            // Frontend tidak boleh menghapus token karena ini bukan masalah token
            console.error('[Auth Middleware] Server/DB error saat verifikasi:', error.message || error);
            return res.status(500).json({ message: 'Terjadi kesalahan server saat memverifikasi sesi. Silakan coba lagi.' });
        }
    }

    if (!token) {
        console.warn('[Auth Middleware] Tidak ada token ditemukan.', { url: req.url, method: req.method });
        return res.status(401).json({ message: 'Tidak terotorisasi, tidak ada token.' });
    }
};

const authorizeAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.is_owner || req.user.is_super_admin)) {
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