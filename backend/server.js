const express = require('express');
const http = require('http');
const helmet = require('helmet');
const WebSocket = require('ws');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Global Logger Control - Mendiamkan log di mode production kecuali error
if (process.env.NODE_ENV === 'production') {
    console.log('--- LOGGING DISABLED (PRODUCTION MODE) ---');
    console.log = function () { };
    console.debug = function () { };
    console.info = function () { };
    console.warn = function () {
        // Tetap tampilkan warn tapi lebih bersih atau bisa dimatikan juga
        // console.warn('WARNING SILENCED');
    };
    // console.error tetap diaktifkan untuk troubleshooting kritis
}

const cron = require('node-cron');

const { startWhatsApp } = require('./src/services/whatsappService');
const { generateAndSendDailyReports } = require('./src/bot/reportGenerator');
const { monitorSlaAndNotifications, sendDowntimeNotifications, sendReconnectNotifications } = require('./src/bot/dataLogger');
const { startBackgroundMonitoring, refreshSecretsNow } = require('./src/bot/backgroundMonitor');
const { setupPppoeListeners } = require('./src/utils/mikrotikListener');
const mikrotikStore = require('./src/utils/mikrotikStore');

let RouterOSAPI = require('node-routeros');
if (RouterOSAPI.RouterOSAPI) {
    RouterOSAPI = RouterOSAPI.RouterOSAPI;
}

// Triggering restart to re-init monitors: 2026-03-18 00:34
const pool = require('./src/config/database');

// Auto-migration: tambah kolom-kolom yang diperlukan jika belum ada
async function runMigrations() {
    // Migration 1: clients.device_id
    try {
        const [columns] = await pool.query("SHOW COLUMNS FROM clients LIKE 'device_id'");
        if (columns.length === 0) {
            await pool.query("ALTER TABLE clients ADD COLUMN device_id INT DEFAULT NULL AFTER workspace_id");
            console.error('[Migrasi] Kolom clients.device_id berhasil ditambahkan');
        }
    } catch (err) {
        console.error('[Migrasi] Error cek clients.device_id:', err.message);
    }

    // Migration 2: downtime_events.reconnect_notification_sent
    try {
        const [cols] = await pool.query("SHOW COLUMNS FROM downtime_events LIKE 'reconnect_notification_sent'");
        if (cols.length === 0) {
            await pool.query("ALTER TABLE downtime_events ADD COLUMN reconnect_notification_sent BOOLEAN DEFAULT FALSE");
            console.error('[Migrasi] Kolom downtime_events.reconnect_notification_sent berhasil ditambahkan');
        }
    } catch (err) {
        console.error('[Migrasi] Error cek downtime_events.reconnect_notification_sent:', err.message);
    }
}
runMigrations();

const { addConnection, removeConnection, getConnection } = require('./src/services/connectionManager');
const { getOrCreateConnection } = require('./src/utils/apiConnection');

const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const pppoeRoutes = require('./src/routes/pppoeRoutes');
const assetRoutes = require('./src/routes/assetRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');
const cloneRoutes = require('./src/routes/cloneRoutes');
const hotspotRoutes = require('./src/routes/hotspotRoutes');
const importRoutes = require('./src/routes/importRoutes');
const registrationRoutes = require('./src/routes/registrationRoutes');
const workspaceRoutes = require('./src/routes/workspaceRoutes');
const deviceRoutes = require('./src/routes/deviceRoutes');
const ipPoolRoutes = require('./src/routes/ipPoolRoutes');
const botRoutes = require('./src/routes/botRoutes');
const slaRoutes = require('./src/routes/slaRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const clientRoutes = require('./src/routes/clientRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const backupRoutes = require('./src/routes/backupRoutes');
const nocRoutes = require('./src/routes/nocRoutes');
const apiKeyRoutes = require('./src/routes/apiKeyRoutes');

const app = express();
const server = http.createServer(app);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS configuration - allow specific origins or use environment variable
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : (process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []);

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // In development, allow all origins OR check against allowed list
        if (process.env.NODE_ENV !== 'production') {
            // Allow all origins in development, or check against allowed list
            if (allowedOrigins.length === 0 || allowedOrigins.indexOf(origin) !== -1) {
                return callback(null, true);
            }
        }

        // In production, check against allowed origins
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    exposedHeaders: ['Set-Cookie'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static('public'));

// Health check endpoint (tanpa auth) - digunakan oleh BackendOfflineOverlay
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.head('/api/health', (req, res) => res.status(200).end());

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/pppoe', pppoeRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/clone', cloneRoutes);
app.use('/api/hotspot', hotspotRoutes);
app.use('/api/import', importRoutes);
app.use('/api/register', registrationRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/ip-pools', ipPoolRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/sla', slaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/noc', nocRoutes);
app.use('/api/api-keys', apiKeyRoutes);

const wss = new WebSocket.Server({ server, path: "/ws" });

function broadcastToWorkspace(workspaceId, deviceId, data) {
    let sentCount = 0;
    wss.clients.forEach((client) => {
        const isDeviceMatch = !deviceId || client.deviceId == deviceId;
        if (client.workspaceId == workspaceId && isDeviceMatch && client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(data));
                sentCount++;
            } catch (error) {
                // Log WS monitoring disabled
            }
        }
    });
    // Log WS monitoring disabled
}

function stopWorkspaceMonitoring(connectionKey, reason = 'Koneksi terputus') {
    const connection = getConnection(connectionKey);
    if (connection) {
        // Broadcast notifikasi disconnect ke workspace
        // Extract workspaceId from connectionKey (format: ws-{workspaceId}-{deviceId})
        // Tapi kita tidak punya workspaceId langsung di parameter, jadi kita ambil dari connectionKey
        const parts = connectionKey.split('-');
        if (parts.length >= 2) {
            const workspaceId = parseInt(parts[1], 10);
            const deviceId = parts[2] ? parseInt(parts[2], 10) : null;

            console.log(`[WebSocket] Menghentikan pemantauan untuk workspace ${workspaceId}, perangkat ${deviceId}. Alasan: ${reason}`);

            try {
                broadcastToWorkspace(workspaceId, deviceId, {
                    type: 'connection-status',
                    payload: {
                        status: 'disconnected',
                        deviceId: deviceId,
                        message: reason,
                        timestamp: Date.now()
                    }
                });
            } catch (e) {
                console.error('[WebSocket] Gagal broadcast disconnect status:', e.message);
            }
        }

        if (connection.intervalId) {
            clearInterval(connection.intervalId);
        }

        if (connection.listenerCleanup) {
            console.log(`[WebSocket] Cleaning up real-time listener for ${connectionKey}`);
            try {
                connection.listenerCleanup();
            } catch (e) {
                console.warn(`[WebSocket] Error cleaning up listener: ${e.message}`);
            }
        }

        removeConnection(connectionKey);
    }
}

async function startWorkspaceMonitoring(workspaceId, connectionKey, deviceId = null) {
    if (getConnection(connectionKey)?.client?.connected) return;

    let client;
    let isRunning = false; // Flag untuk mencegah multiple execution bersamaan
    let lastCycleTime = 0; // Track waktu cycle terakhir
    let cachedSecrets = [];

    try {
        const WS_TIMEOUT = 24 * 60 * 60 * 1000;
        client = await getOrCreateConnection(workspaceId, WS_TIMEOUT, connectionKey, deviceId);

        // Tentukan status koneksi berdasarkan store yang di-\update oleh dataLogger
        const currentDeviceStatus = mikrotikStore.getDeviceStatus(workspaceId, deviceId);

        // Broadcast status
        broadcastToWorkspace(workspaceId, deviceId, {
            type: 'connection-status',
            payload: {
                status: currentDeviceStatus,
                deviceId: deviceId,
                message: currentDeviceStatus === 'connected' ? 'Terhubung ke perangkat Mikrotik' : 'Koneksi ke perangkat Mikrotik terputus',
                timestamp: Date.now()
            }
        });

        // Tambahkan error handler pada client untuk menangkap error yang tidak terduga
        if (client && client.on) {
            client.on('error', (error) => {
                // Log WS monitoring disabled
                // Hapus koneksi dari cache jika terjadi error
                stopWorkspaceMonitoring(connectionKey, `Error pada koneksi: ${error.message || 'Unknown error'}`);
            });
        }

        // --- REAL-TIME LISTENERS INITIALIZATION ---
        let listenerCleanup = null;

        /**
         * Broadcast pppoe update instan ke frontend (True Real-time)
         * Meminimalisir delay interval 3 detik.
         */
        const broadcastPppoeUpdate = () => {
            const activeUsers = mikrotikStore.getActive(workspaceId, deviceId);
            const activeUserMap = new Map();
            activeUsers.forEach(user => {
                if (user.name) {
                    activeUserMap.set(user.name, {
                        address: user.address || null,
                        uptime: user.uptime || null,
                        service: user.service || 'pppoe',
                        '.id': user['.id'] || null
                    });
                }
            });

            const enrichedSecrets = cachedSecrets.map(secret => {
                const activeInfo = activeUserMap.get(secret.name);
                const isActive = !!activeInfo;
                const enriched = Object.assign({}, secret);
                enriched.deviceId = deviceId;
                enriched.isActive = isActive;
                if (isActive && activeInfo.uptime) enriched.uptime = activeInfo.uptime;
                if (isActive && activeInfo['.id']) enriched.activeConnectionId = activeInfo['.id'];
                if (isActive && activeInfo.address) {
                    enriched.currentAddress = activeInfo.address;
                    if (!enriched['remote-address']) enriched['remote-address'] = activeInfo.address;
                }
                return enriched;
            });

            broadcastToWorkspace(workspaceId, deviceId, {
                type: 'pppoe-update',
                payload: { pppoeSecrets: enrichedSecrets }
            });
        };

        try {
            // Ambil detail device untuk listener
            const [devices] = await pool.query(
                'SELECT * FROM mikrotik_devices WHERE id = ? AND workspace_id = ?',
                [deviceId, workspaceId]
            );

            if (devices && devices[0]) {
                const device = devices[0];
                setupPppoeListeners(device, {
                    onSecretUpdate: (action, attributes) => {
                        console.log(`[RealTime][Secret] ${action.toUpperCase()}: ${attributes.name}`);
                        // Update lokal cache di server.js
                        if (action === 'add' || action === 'change') {
                            const index = cachedSecrets.findIndex(s => s['.id'] === attributes['.id'] || s.name === attributes.name);
                            if (index !== -1) {
                                cachedSecrets[index] = { ...cachedSecrets[index], ...attributes };
                            } else {
                                cachedSecrets.push(attributes);
                            }
                        } else if (action === 'remove') {
                            cachedSecrets = cachedSecrets.filter(s => s['.id'] !== attributes['.id'] && s.name !== attributes.name);
                        }

                        // Update global store untuk diakses Controller
                        mikrotikStore.updateSecret(workspaceId, deviceId, action, attributes);

                        // INSTANT BROADCAST (True Real-time)
                        broadcastPppoeUpdate();
                    },
                    onActiveUpdate: (action, attributes) => {
                        console.log(`[RealTime][Active] ${action.toUpperCase()}: ${attributes.name}`);
                        const currentActive = mikrotikStore.getActive(workspaceId, deviceId);
                        let updatedActive = [...currentActive];

                        if (action === 'add' || action === 'change') {
                            const index = updatedActive.findIndex(a => a['.id'] === attributes['.id'] || a.name === attributes.name);
                            if (index !== -1) {
                                updatedActive[index] = { ...updatedActive[index], ...attributes };
                            } else {
                                updatedActive.push(attributes);
                            }
                        } else if (action === 'remove') {
                            updatedActive = updatedActive.filter(a => a['.id'] !== attributes['.id'] && a.name !== attributes.name);
                        }

                        mikrotikStore.setActive(workspaceId, deviceId, updatedActive);

                        // INSTANT BROADCAST (True Real-time)
                        broadcastPppoeUpdate();
                    },
                    onError: (err) => {
                        console.error(`[RealTime] Listener error untuk workspace ${workspaceId}:`, err.message);
                    }
                }).then(setupResult => {
                    listenerCleanup = setupResult.cleanup;
                }).catch(listenerError => {
                    console.warn(`[RealTime] Gagal inisialisasi listener untuk workspace ${workspaceId}:`, listenerError.message);
                });
            }
        } catch (error) {
            console.error(`[RealTime] Error menyiapkan listener database untuk workspace ${workspaceId}:`, error.message);
        }

        // Set interval untuk sync snapshot dashboard (setiap 30 detik)
        // Kita tidak lagi memanggil MikroTik API di sini karena backgroundMonitor sudah melakukan polling global.
        const intervalId = setInterval(async () => {
            if (isRunning) return;
            isRunning = true;
            try {
                // Snapshot sync is handled by backgroundMonitor now
            } finally {
                isRunning = false;
            }
        }, 30000); 

        const connection = getConnection(connectionKey);
        if (connection) {
            connection.intervalId = intervalId;
            connection.listenerCleanup = listenerCleanup; // Simpan untuk dibersihkan nanti
            connection.forceSecretRefresh = () => {
                console.log(`[WebSocket] Force refresh trigger untuk workspace ${workspaceId}`);
                refreshSecretsNow(workspaceId, deviceId).catch(console.error);
            };
        }

    } catch (connectError) {
        // Handle error koneksi dengan lebih baik
        if (client?.connected) {
            try {
                await client.close();
            } catch (closeError) {
                // Ignore close error
            }
        }
    }
}

wss.on('connection', (ws, req) => {
    // Set connection timeout untuk mencegah hanging
    let connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            console.warn('[WebSocket] Connection setup timeout, menutup koneksi');
            try {
                ws.close(1008, 'Connection setup timeout');
            } catch (e) {
                // Ignore jika sudah closed
            }
        }
    }, 65000); // 65 detik timeout untuk setup connection agar tidak membunuh setup listener router

    // Cek apakah WebSocket sudah di-close sebelum setup selesai
    const checkIfClosed = () => {
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            console.log('[WebSocket] Koneksi ditutup sebelum setup selesai');
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
            }
            return true;
        }
        return false;
    };

    // Handle connection setup secara async tapi jangan block
    (async () => {
        try {
            // Cek apakah sudah di-close sebelum mulai
            if (checkIfClosed()) return;
            let token = null;
            let decoded = null;

            // Parse URL untuk mendapatkan query parameters
            console.log('[WebSocket] URL Permintaan:', req.url);
            console.log('[WebSocket] Header permintaan:', {
                cookie: req.headers.cookie ? 'Ada' : 'Tidak ada',
                authorization: req.headers.authorization ? 'Ada' : 'Tidak ada',
                host: req.headers.host
            });

            let urlParams = new URLSearchParams();
            if (req.url.includes('?')) {
                const queryString = req.url.split('?')[1];
                urlParams = new URLSearchParams(queryString);
            }
            console.log('[WebSocket] Parameter query:', Object.fromEntries(urlParams));

            // Prioritas 1: Cek token di query parameter (untuk WebSocket yang tidak bisa kirim cookie dengan mudah)
            const tokenParam = urlParams.get('token');
            console.log('[WebSocket] Token dari query param:', tokenParam ? `Ada (${tokenParam.substring(0, 20)}...)` : 'Tidak ada');
            if (tokenParam) {
                try {
                    decoded = jwt.verify(tokenParam, process.env.JWT_SECRET);
                    token = tokenParam;
                    console.log('[WebSocket] Menggunakan token dari query parameter, user:', decoded.id);
                } catch (e) {
                    console.warn('[WebSocket] Token di query param tidak valid:', e.message);
                }
            }

            // Prioritas 2: Cek cookie jika token dari query param tidak ada atau tidak valid
            if (!token) {
                const cookie = (req.headers.cookie || '').split('; ').find(c => c.startsWith('token='));
                if (cookie) {
                    token = cookie.split('=')[1];
                    try {
                        decoded = jwt.verify(token, process.env.JWT_SECRET);
                        console.log('[WebSocket] Menggunakan token dari cookie');
                    } catch (e) {
                        console.warn('[WebSocket] Token di cookie tidak valid:', e.message);
                        token = null;
                    }
                }
            }

            // Prioritas 3: Cek Authorization header sebagai fallback terakhir
            if (!token && req.headers.authorization) {
                const authHeader = req.headers.authorization;
                if (authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                    try {
                        decoded = jwt.verify(token, process.env.JWT_SECRET);
                        console.log('[WebSocket] Menggunakan token dari Authorization header');
                    } catch (e) {
                        console.warn('[WebSocket] Token di Authorization header tidak valid:', e.message);
                        token = null;
                    }
                }
            }

            if (!token || !decoded) {
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }
                console.warn('[WebSocket] Tidak ada token ditemukan, menutup koneksi');
                console.warn('[WebSocket] URL:', req.url);
                console.warn('[WebSocket] Cookies:', req.headers.cookie);
                console.warn('[WebSocket] Authorization:', req.headers.authorization);
                if (!checkIfClosed()) {
                    try {
                        ws.close(1008, 'Unauthorized: No token provided');
                    } catch (e) {
                        // Ignore jika sudah closed
                    }
                }
                return;
            }

            // Cek lagi apakah sudah di-close
            if (checkIfClosed()) return;

            const [users] = await pool.query('SELECT workspace_id FROM users WHERE id = ?', [decoded.id]);
            if (!users[0]?.workspace_id) {
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }
                console.warn(`[WebSocket] User ${decoded.id} tidak punya workspace_id`);
                if (!checkIfClosed()) {
                    try {
                        ws.close(1008, 'Unauthorized: No workspace');
                    } catch (e) {
                        // Ignore jika sudah closed
                    }
                }
                return;
            }

            // Cek lagi apakah sudah di-close
            if (checkIfClosed()) return;

            ws.workspaceId = users[0].workspace_id;

            // Parse deviceId dari query string
            const deviceIdParam = urlParams.get('deviceId');
            const deviceId = deviceIdParam ? parseInt(deviceIdParam) : null;
            console.log('[WebSocket] DeviceId dari query param:', deviceId);

            // Jika deviceId tidak diberikan, gunakan active_device_id
            let finalDeviceId = deviceId;
            if (!finalDeviceId) {
                const [workspaces] = await pool.query('SELECT active_device_id FROM workspaces WHERE id = ?', [ws.workspaceId]);
                finalDeviceId = workspaces[0]?.active_device_id || null;
            }

            if (!finalDeviceId) {
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }
                console.warn(`[WebSocket] Tidak ada device untuk workspace ${ws.workspaceId}`);
                if (!checkIfClosed()) {
                    try {
                        ws.close(1008, 'No device configured');
                    } catch (e) {
                        // Ignore jika sudah closed
                    }
                }
                return;
            }

            // Cek lagi apakah sudah di-close sebelum start monitoring
            if (checkIfClosed()) return;

            ws.deviceId = finalDeviceId;
            const connectionKey = `ws-${ws.workspaceId}-${finalDeviceId}`;

            // Cek apakah backgroundMonitor sudah populate mikrotikStore untuk device ini
            const storedSecrets = mikrotikStore.getSecrets(ws.workspaceId, finalDeviceId);
            const storedActive = mikrotikStore.getActive(ws.workspaceId, finalDeviceId);
            const deviceStatus = mikrotikStore.getDeviceStatus(ws.workspaceId, finalDeviceId);

            // Kirim status koneksi terkini ke client
            try {
                ws.send(JSON.stringify({
                    type: 'connection-status',
                    payload: {
                        status: deviceStatus,
                        deviceId: finalDeviceId,
                        message: deviceStatus === 'connected' ? 'Terhubung ke perangkat Mikrotik' : 'Koneksi ke perangkat Mikrotik terputus',
                        timestamp: Date.now()
                    }
                }));
            } catch (e) { }

            // Jika background monitor sudah punya data, kirim snapshot langsung
            if (storedSecrets.length > 0 && deviceStatus === 'connected') {
                console.log(`[WebSocket] Data BGMonitor tersedia untuk perangkat ${finalDeviceId}, mengirim snapshot langsung`);
                const activeMap = new Map(storedActive.map(u => [u.name, u]));
                const enriched = storedSecrets.map(secret => {
                    const activeInfo = activeMap.get(secret.name);
                    const s = Object.assign({}, secret);
                    s.isActive = !!activeInfo;
                    if (activeInfo?.uptime) s.uptime = activeInfo.uptime;
                    if (activeInfo?.['.id']) s.activeConnectionId = activeInfo['.id'];
                    if (activeInfo?.address) {
                        s.currentAddress = activeInfo.address;
                        if (!s['remote-address']) s['remote-address'] = activeInfo.address;
                    }
                    return s;
                });
                try {
                    ws.send(JSON.stringify({
                        type: 'batch-update',
                        payload: { resource: {}, pppoeSecrets: enriched, activeInterfaces: [], traffic: {} }
                    }));
                } catch (e) { }
            } else {
                // Fallback: start monitoring loop jika backgroundMonitor belum ready
                console.log(`[WebSocket] BGMonitor belum memiliki data untuk perangkat ${finalDeviceId}, memulai loop pemantauan`);
                let connection = getConnection(connectionKey);
                if (!connection) {
                    if (checkIfClosed()) return;
                    await startWorkspaceMonitoring(ws.workspaceId, connectionKey, finalDeviceId);
                    if (checkIfClosed()) return;
                    connection = getConnection(connectionKey);
                }
                if (connection) connection.userCount = (connection.userCount || 0) + 1;
            }

            let connection = getConnection(connectionKey);
            if (connection) {
                connection.userCount = (connection.userCount || 0) + 1;
            }

            // Clear connection timeout setelah setup berhasil
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
            }

            console.log(`[WebSocket] Koneksi berhasil dikonfigurasi untuk workspace ${ws.workspaceId}, perangkat ${finalDeviceId}`);

            ws.on('message', async (message) => { // Dibuat async
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'force-refresh' && data.target === 'secrets') {
                        console.log(`[WebSocket] Menerima force-refresh dari client untuk workspace ${ws.workspaceId}. Data dikirim dari memory cache (Store).`);
                        
                        // Ambil pasokan terbaru dari Global Store (diperbarui backgroundMonitor)
                        const pppoeSecrets = mikrotikStore.getSecrets(ws.workspaceId, finalDeviceId) || [];
                        const activeUsers = mikrotikStore.getActive(ws.workspaceId, finalDeviceId) || [];
                        
                        const activeUserMap = new Map();
                        activeUsers.forEach(user => {
                            if (user.name) {
                                activeUserMap.set(user.name, {
                                    address: user.address || null,
                                    uptime: user.uptime || null,
                                    service: user.service || 'pppoe',
                                    '.id': user['.id'] || null
                                });
                            }
                        });

                        const enrichedSecrets = pppoeSecrets.map(secret => {
                            const activeInfo = activeUserMap.get(secret.name);
                            const isActive = !!activeInfo;
                            const enriched = Object.assign({}, secret);
                            enriched.isActive = isActive;
                            if (isActive && activeInfo.uptime) enriched.uptime = activeInfo.uptime;
                            if (isActive && activeInfo['.id']) enriched.activeConnectionId = activeInfo['.id'];
                            if (isActive && activeInfo.address) {
                                enriched.currentAddress = activeInfo.address;
                                if (!enriched['remote-address']) enriched['remote-address'] = activeInfo.address;
                            }
                            return enriched;
                        });

                        // Kirim balik hanya kepada klien yang meminta
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'pppoe-update',
                                payload: { pppoeSecrets: enrichedSecrets }
                            }));
                        }
                    }
                } catch (e) {
                    // Ignore non-JSON messages
                }
            });

            ws.on('close', () => {
                const currentConnection = getConnection(connectionKey);
                if (currentConnection) {
                    currentConnection.userCount--;
                    if (currentConnection.userCount <= 0) {
                        stopWorkspaceMonitoring(connectionKey);
                    }
                }
            });

            ws.on('error', (error) => {
                console.error('[WebSocket] Error pada koneksi:', error);
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }
            });
        } catch (error) {
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
            }
            console.error('[WebSocket] Error:', error);
            // Hanya close jika connection masih dalam state yang valid
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                try {
                    ws.close(1011, 'Internal server error');
                } catch (closeError) {
                    console.error('[WebSocket] Error saat menutup koneksi:', closeError);
                }
            }
        }
    })(); // End async IIFE
});

// Process-level error handlers untuk mencegah crash aplikasi
process.on('uncaughtException', (error) => {
    // Handle error RouterOS UNKNOWNREPLY khusus, terutama !empty
    if (error.errno === 'UNKNOWNREPLY' || error.message?.includes('UNKNOWNREPLY')) {
        // !empty bukan error fatal, hanya indikasi hasil query kosong
        if (error.message?.includes('!empty') || error.message?.includes('unknown reply: !empty')) {
            // BENAR-BENAR DIAMKAN: !empty reply adalah noise dari library node-routeros
            return;
        }
        console.error('[Uncaught Exception] RouterOS UNKNOWNREPLY error:', error.message);
        console.error('[Uncaught Exception] Stack:', error.stack);
        // Jangan exit, hanya log error
        return;
    }
    console.error('[Uncaught Exception] Fatal error:', error);
    // Untuk error lain yang fatal, tetap exit tapi dengan log yang jelas
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    // Handle unhandled promise rejection
    if (reason && (reason.errno === 'UNKNOWNREPLY' || reason.message?.includes('UNKNOWNREPLY'))) {
        // !empty bukan error fatal
        if (reason.message?.includes('!empty') || reason.message?.includes('unknown reply: !empty')) {
            // BENAR-BENAR DIAMKAN: !empty reply adalah noise dari library node-routeros
            return;
        }
        console.error('[Unhandled Rejection] RouterOS UNKNOWNREPLY error:', reason.message);
        return; // Jangan exit untuk error ini
    }
    console.error('[Unhandled Rejection] Unhandled promise rejection:', reason);
});

app.get('/api/debug/store', (req, res) => {
    const mikrotikStore = require('./src/utils/mikrotikStore');
    const storeKeys = mikrotikStore.getSecretsKeys ? mikrotikStore.getSecretsKeys() : [];
    
    const results = {};
    storeKeys.forEach(key => {
        const parts = key.split('_');
        results[key] = {
            active: mikrotikStore.getActive(parts[0], parts[1]).length,
            secrets: mikrotikStore.getSecrets(parts[0], parts[1]).length,
            status: mikrotikStore.getDeviceStatus(parts[0], parts[1])
        };
    });

    res.json({
        time: new Date().toISOString(),
        keys: storeKeys,
        data: results
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('[Global Error Handler]:', err);
    res.status(err.status || 500).json({
        message: err.message || 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

const PORT = process.env.PORT || 9494;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server backend berjalan di port ${PORT} dan terbuka untuk jaringan`);

    // Background logging - DISABLED as per user request to save storage
    // cron.schedule('*/3 * * * * *', logAllActiveWorkspaces);

    // SLA & Notifikasi monitoring - setiap 3 detik (untuk update SLA dan notifikasi)
    // Berjalan terus menerus, tidak bergantung pada user login
    cron.schedule(process.env.SLA_MONITOR_CRON || '*/3 * * * * *', () => {
        monitorSlaAndNotifications(broadcastToWorkspace);
    });

    // Dashboard snapshot - DISABLED as per user request to save storage
    // cron.schedule('*/3 * * * * *', updateAllDashboardSnapshots);

    // Downtime notifications - setiap 30 detik (cek downtime > 2 menit dan kirim notifikasi)
    // Berjalan terus menerus, tidak bergantung pada user login
    cron.schedule(process.env.DOWNTIME_NOTIFY_CRON || '*/30 * * * * *', () => {
        sendDowntimeNotifications(broadcastToWorkspace);
        sendReconnectNotifications(broadcastToWorkspace);
    });

    /* 
    // Daily reports - setiap hari jam 00:00 - DISABLED as per user request
    cron.schedule('0 0 * * *', generateAndSendDailyReports, {
        timezone: "Asia/Jakarta"
    });
    */

    // Database cleanup - setiap hari jam 02:00 (menghapus log lama untuk menghemat storage dan memory)
    cron.schedule(process.env.DB_CLEANUP_CRON || '0 2 * * *', async () => {
        try {
            console.log('[Cleanup] Memulai cleanup data lama...');

            // Delete resource logs older than 30 days
            const resourceResult = await pool.query(
                'DELETE FROM resource_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)'
            );
            console.log(`[Cleanup] ✅ Dihapus ${resourceResult[0].affectedRows} resource log entries lama`);

            // Delete downtime events older than 90 days
            const downtimeResult = await pool.query(
                'DELETE FROM downtime_events WHERE start_time < DATE_SUB(NOW(), INTERVAL 90 DAY)'
            );
            console.log(`[Cleanup] ✅ Dihapus ${downtimeResult[0].affectedRows} downtime event entries lama`);

            // Delete pppoe usage logs older than 90 days
            const usageResult = await pool.query(
                'DELETE FROM pppoe_usage_logs WHERE usage_date < DATE_SUB(NOW(), INTERVAL 90 DAY)'
            );
            console.log(`[Cleanup] ✅ Dihapus ${usageResult[0].affectedRows} pppoe usage log entries lama`);

            // Optimize tables to reclaim space
            await pool.query('OPTIMIZE TABLE resource_logs');
            await pool.query('OPTIMIZE TABLE downtime_events');
            await pool.query('OPTIMIZE TABLE pppoe_usage_logs');
            console.log('[Cleanup] ✅ Tabel berhasil di-optimize');

            // Force garbage collection if available
            if (global.gc) {
                const before = process.memoryUsage().heapUsed / 1024 / 1024;
                global.gc();
                const after = process.memoryUsage().heapUsed / 1024 / 1024;
                console.log(`[Cleanup] ✅ Garbage collection selesai. Memory freed: ${(before - after).toFixed(2)} MB`);
            }

        } catch (error) {
            console.error('[Cleanup] ❌ Error saat cleanup:', error.message);
        }
    }, {
        timezone: "Asia/Jakarta"
    });

    console.log('[Tugas Rutin] Pencatatan latar belakang: DIMATIKAN');
    console.log('[Tugas Rutin] Pemantauan SLA & Notifikasi: setiap 3 detik');
    console.log('[Tugas Rutin] Snapshot dashboard: DIMATIKAN');
    console.log('[Tugas Rutin] Notifikasi gangguan: setiap 30 detik');
    console.log('[Tugas Rutin] Laporan harian: setiap hari jam 00:00');
    console.log('[Tugas Rutin] Pembersihan database: setiap hari jam 02:00');
});

startWhatsApp().catch(err => {
    console.error("Gagal memulai WhatsApp Service:", err);
});

// Mulai background monitoring untuk semua device secara independen
// Ini memastikan mikrotikStore selalu diupdate tanpa bergantung pada WS connections
setTimeout(() => {
    startBackgroundMonitoring(broadcastToWorkspace).catch(err => {
        console.error('[Pemantauan] Gagal memulai layanan latar belakang:', err.message);
    });
}, 3000); // Tunggu 3 detik setelah server ready
console.error('[Sistem] Layanan pemantauan latar belakang (Optimized) AKTIF');
