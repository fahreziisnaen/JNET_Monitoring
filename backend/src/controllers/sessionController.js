const pool = require('../config/database');
const UAParser = require('ua-parser-js');

exports.getActiveSessions = async (req, res) => {
    const userId = req.user?.id;
    const currentTokenId = req.user?.jti;

    console.log('[Session Controller] getActiveSessions called:', { userId, currentTokenId });

    if (!userId) {
        console.warn('[Session Controller] No userId found');
        return res.status(401).json({ message: 'Tidak terotorisasi.' });
    }

    try {
        // Auto-prune old sessions (> 7 days) before fetching
        await pool.query('DELETE FROM user_sessions WHERE user_id = ? AND last_seen < DATE_SUB(NOW(), INTERVAL 7 DAY)', [userId]);

        const [sessions] = await pool.query(
            'SELECT * FROM user_sessions WHERE user_id = ? ORDER BY last_seen DESC',
            [userId]
        );

        // --- Aggressive Self-Healing Deduplication ---
        const parser = new UAParser();
        const seenFingerprints = new Set();
        const duplicateIds = [];
        const uniqueSessionsList = [];

        sessions.forEach(session => {
            // Normalize IP for fingerprinting
            let ip = session.ip_address || 'Unknown';
            if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
            if (ip === '::1') ip = '127.0.0.1';

            // Parse UA for fingerprinting
            parser.setUA(session.user_agent || "");
            const ua = parser.getResult();
            const browserName = ua.browser.name || 'Unknown';
            const browserMajor = ua.browser.major || '0';
            const osName = ua.os.name || 'Unknown';

            // Fingerprint: BrowserName + Major + OS + IP
            const fingerprint = `${browserName}_${browserMajor}_${osName}_${ip}`;

            // If this is the current session, we ALWAYS keep it
            const isCurrent = session.token_id === currentTokenId;

            if (isCurrent) {
                uniqueSessionsList.push(session);
                seenFingerprints.add(fingerprint);
            } else if (!seenFingerprints.has(fingerprint)) {
                uniqueSessionsList.push(session);
                seenFingerprints.add(fingerprint);
            } else {
                duplicateIds.push(session.id);
            }
        });

        // Delete duplicates from DB in background
        if (duplicateIds.length > 0) {
            console.log(`[Session Cleanup] Removing ${duplicateIds.length} duplicate ghost sessions for user ${userId}. Fingerprint matching used.`);
            pool.query('DELETE FROM user_sessions WHERE id IN (?)', [duplicateIds]).catch(err => {
                console.error("[Session Cleanup] Error deleting duplicates:", err);
            });
        }
        // Use uniqueSessionsList for display
        const displaySessions = uniqueSessionsList;
        // --- End Deduplication ---

        console.log(`[Session Controller] Found ${displaySessions.length} unique sessions for user ${userId}`);

        const detailedSessions = displaySessions.map(session => {
            parser.setUA(session.user_agent || "");
            const uaResult = parser.getResult();

            return {
                id: session.id,
                browser: `${uaResult.browser.name || 'Unknown'} ${uaResult.browser.version || ''}`.trim(),
                os: `${uaResult.os.name || 'Unknown'} ${uaResult.os.version || ''}`.trim(),
                ip_address: session.ip_address || 'N/A',
                last_seen: session.last_seen,
                isCurrentSession: session.token_id === currentTokenId
            };
        });

        console.log('[Session Controller] Returning sessions:', detailedSessions.length);
        res.status(200).json(detailedSessions);
    } catch (error) {
        console.error("[Session Controller] GET SESSIONS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil data sesi.', error: error.message });
    }
};

exports.deleteSession = async (req, res) => {
    const sessionIdToDelete = req.params.id;
    const currentUserId = req.user.id;

    try {
        const [result] = await pool.query(
            'DELETE FROM user_sessions WHERE id = ? AND user_id = ?',
            [sessionIdToDelete, currentUserId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Sesi tidak ditemukan atau Anda tidak punya izin.' });
        }

        res.status(200).json({ message: 'Sesi berhasil dihentikan.' });
    } catch (error) {
        console.error("DELETE SESSION ERROR:", error);
        res.status(500).json({ message: 'Gagal menghentikan sesi.' });
    }
};