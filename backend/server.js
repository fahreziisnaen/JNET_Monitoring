const express = require('express');
const http = require('http');
const helmet = require('helmet');
const WebSocket = require('ws');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cron = require('node-cron');

const { startWhatsApp } = require('./src/services/whatsappService');
const { handleCommand } = require('./src/bot/commandHandler');
const { generateAndSendDailyReports } = require('./src/bot/reportGenerator');
const { logAllActiveWorkspaces, processSlaEvents, monitorSlaAndNotifications, updateAllDashboardSnapshots, sendDowntimeNotifications } = require('./src/bot/dataLogger');

let RouterOSAPI = require('node-routeros');
if (RouterOSAPI.RouterOSAPI) {
    RouterOSAPI = RouterOSAPI.RouterOSAPI;
}

const pool = require('./src/config/database');
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

const app = express();
const server = http.createServer(app);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS configuration - allow specific origins or use environment variable
const allowedOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'http://172.27.0.10:3000'
    ];

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

const wss = new WebSocket.Server({ server, path: "/ws" });

function broadcastToWorkspace(workspaceId, data) {
    let sentCount = 0;
    wss.clients.forEach((client) => {
        if (client.workspaceId === workspaceId && client.readyState === WebSocket.OPEN) {
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

function stopWorkspaceMonitoring(connectionKey) {
    const connection = getConnection(connectionKey);
    if (connection) {
        clearInterval(connection.intervalId);
        removeConnection(connectionKey);
    }
}

async function startWorkspaceMonitoring(workspaceId, connectionKey, deviceId = null) {
    if (getConnection(connectionKey)?.client?.connected) return;
    
    let client;
    let isRunning = false; // Flag untuk mencegah multiple cycle bersamaan
    let lastCycleTime = 0; // Track waktu cycle terakhir
    
    try {
        const WS_TIMEOUT = 24 * 60 * 60 * 1000;
        client = await getOrCreateConnection(workspaceId, WS_TIMEOUT, connectionKey, deviceId);
        
        // Tambahkan error handler pada client untuk menangkap error yang tidak terduga
        if (client && client.on) {
            client.on('error', (error) => {
                // Log WS monitoring disabled
                // Hapus koneksi dari cache jika terjadi error
                stopWorkspaceMonitoring(connectionKey);
            });
        }

        const runMonitoringCycle = async () => {
            // Prevent multiple cycle running at the same time
            if (isRunning) {
                return;
            }
            
            // Prevent cycle terlalu cepat (minimal 2 detik antara cycle)
            const now = Date.now();
            if (now - lastCycleTime < 2000) {
                return;
            }
            
            isRunning = true;
            lastCycleTime = now;
            if (!client?.connected) {
                return stopWorkspaceMonitoring(connectionKey);
            }
            try {
                // Wrap setiap command dengan error handling dan timeout yang lebih panjang
                const safeWrite = async (command, params = [], timeoutMs = 10000) => {
                    return Promise.race([
                        (async () => {
                            try {
                                const result = await client.write(command, params);
                                return result;
                            } catch (err) {
                                // !empty bukan error fatal, return empty array
                                if (err.message?.includes('!empty') || err.message?.includes('unknown reply: !empty')) {
                                    return [];
                                }
                                throw err;
                            }
                        })(),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error(`Timeout setelah ${timeoutMs}ms untuk command ${command}`)), timeoutMs)
                        )
                    ]);
                };
                
                // Jalankan command secara sequential dengan timeout lebih panjang (10 detik)
                const resource = await safeWrite('/system/resource/print', [], 10000).then(r => r[0] || {}).catch(err => {
                    return {};
                });
                
                const pppoeActive = await safeWrite('/ppp/active/print', [], 10000).catch(err => {
                    return [];
                });
                
                // Ambil total secrets untuk summary (dengan timeout lebih panjang karena bisa banyak)
                // Ini akan digunakan untuk summary total dan inactive count
                const pppoeSecrets = await safeWrite('/ppp/secret/print', [], 25000).catch(err => {
                    return [];
                });
                
                // Merge pppoeActive ke pppoeSecrets: tambahkan info aktif (isActive, uptime, currentAddress)
                // Buat Map untuk lookup cepat dari pppoeActive
                const activeUserMap = new Map();
                pppoeActive.forEach(user => {
                    if (user.name) {
                        activeUserMap.set(user.name, {
                            address: user.address || null,
                            uptime: user.uptime || null,
                            service: user.service || 'pppoe',
                            '.id': user['.id'] || null
                        });
                    }
                });
                
                // Enrich pppoeSecrets dengan data dari pppoeActive
                const enrichedSecrets = pppoeSecrets.map(secret => {
                    const activeInfo = activeUserMap.get(secret.name);
                    const isActive = !!activeInfo;
                    
                    // Build enriched secret object
                    const enriched = Object.assign({}, secret);
                    
                    // Tambahkan field isActive
                    enriched.isActive = isActive;
                    
                    // Tambahkan uptime jika aktif
                    if (isActive && activeInfo.uptime) {
                        enriched.uptime = activeInfo.uptime;
                    }
                    
                    // Tambahkan .id dari active connection untuk keperluan kick
                    if (isActive && activeInfo['.id']) {
                        enriched.activeConnectionId = activeInfo['.id'];
                    }
                    
                    // Untuk remote-address: prioritas 1) dari active connection, 2) dari secret, 3) null
                    if (isActive && activeInfo.address) {
                        enriched.currentAddress = activeInfo.address;
                        // Jika secret tidak punya remote-address, gunakan dari active connection
                        if (!enriched['remote-address']) {
                            enriched['remote-address'] = activeInfo.address;
                        }
                    }
                    
                    return enriched;
                });
                
                // Catatan: processSlaEvents TIDAK dipanggil di sini untuk menghindari duplikasi notifikasi
                // processSlaEvents sudah dijalankan oleh cron job monitorSlaAndNotifications setiap 3 detik
                // yang berjalan terus menerus tanpa bergantung pada user login
                
                const allInterfaces = await safeWrite('/interface/print', [], 10000).catch(err => {
                    return [];
                });
                
                // Filter interface yang aktif (running) untuk ditampilkan di frontend
                const activeInterfacesList = allInterfaces
                    .filter(iface => {
                        const running = iface.running === 'true' || iface.running === true || iface.running === 'yes';
                        return running;
                    })
                    .map(iface => ({
                        name: iface.name,
                        type: iface.type || 'unknown',
                        running: iface.running
                    }));
                
                // Filter interface yang akan di-monitor traffic-nya
                // Exclude interface yang tidak bisa di-monitor traffic-nya dan PPPoE
                const interfacesToMonitor = allInterfaces
                    .filter(iface => {
                        const type = (iface.type || '').toLowerCase();
                        const running = iface.running === 'true' || iface.running === true || iface.running === 'yes';
                        
                        // Exclude interface yang tidak bisa di-monitor traffic-nya dan PPPoE
                        const excludeTypes = ['loopback', 'pppoe-in', 'pppoe-out', 'pptp-in', 'l2tp-in'];
                        
                        // Exclude semua interface yang mengandung 'pppoe' di type-nya
                        if (type.includes('pppoe')) return false;
                        
                        // Include jika running dan tidak di exclude list
                        return running && !excludeTypes.includes(type);
                    })
                    .map(iface => iface.name);

                // Ambil traffic data dengan timeout lebih pendek (3 detik per interface)
                const trafficPromises = interfacesToMonitor.map(name => 
                    safeWrite('/interface/monitor-traffic', [`=interface=${name}`, '=once='], 3000)
                        .then(r => r[0])
                        .catch(err => {
                            return null;
                        })
                );

                const trafficResults = await Promise.all(trafficPromises);
                const trafficUpdateBatch = {};
                trafficResults.forEach(result => {
                    if (result && result.name) {
                        trafficUpdateBatch[result.name] = result;
                    }
                });
                
                // Pastikan resource selalu ada, meskipun kosong
                const finalResource = resource && Object.keys(resource).length > 0 ? resource : {};
                
                const batchPayload = { 
                    resource: finalResource, 
                    pppoeSecrets: enrichedSecrets || [], // Secrets yang sudah di-enrich dengan info aktif (isActive, uptime, currentAddress)
                    activeInterfaces: activeInterfacesList || [], // Kirim list interface aktif
                    traffic: trafficUpdateBatch 
                };
                broadcastToWorkspace(workspaceId, { type: 'batch-update', payload: batchPayload });
                
            } catch (cycleError) {
                // Handle error khusus untuk UNKNOWNREPLY
                if (cycleError.errno === 'UNKNOWNREPLY' || cycleError.message?.includes('UNKNOWNREPLY')) {
                    // Jangan stop monitoring untuk !empty, hanya untuk error lain
                    if (cycleError.message?.includes('!empty')) {
                        // Tetap kirim data kosong agar frontend tahu koneksi masih aktif
                        const emptyPayload = { resource: {}, pppoeSecrets: [], activeInterfaces: [], traffic: {} };
                        broadcastToWorkspace(workspaceId, { type: 'batch-update', payload: emptyPayload });
                        return; // Lanjutkan monitoring
                    }
                    stopWorkspaceMonitoring(connectionKey);
                    return;
                }
                // Jangan stop monitoring untuk error lain, coba kirim data kosong dulu
                try {
                    const emptyPayload = { resource: {}, pppoeSecrets: [], activeInterfaces: [], traffic: {} };
                    broadcastToWorkspace(workspaceId, { type: 'batch-update', payload: emptyPayload });
                } catch (broadcastError) {
                    // Log WS monitoring disabled
                }
                // Hanya stop jika error fatal
                if (cycleError.message?.includes('not connected') || cycleError.message?.includes('connection closed')) {
                    stopWorkspaceMonitoring(connectionKey);
                }
            } finally {
                isRunning = false; // Reset flag setelah cycle selesai
            }
        };

        // Set interval untuk monitoring cycle setiap 3 detik
        // Jalankan sekali langsung untuk immediate data
        setTimeout(() => {
            runMonitoringCycle().catch(err => {
                isRunning = false;
            });
        }, 1000); // Tunggu 1 detik sebelum mulai
        
        const intervalId = setInterval(() => {
            runMonitoringCycle().catch(err => {
                isRunning = false; // Reset flag jika error
            });
        }, 3000); // Interval 3 detik
        
        const connection = getConnection(connectionKey);
        if (connection) {
            connection.intervalId = intervalId;
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
    }, 15000); // 15 detik timeout untuk setup connection
    
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
        console.log('[WebSocket] Request URL:', req.url);
        console.log('[WebSocket] Request headers:', {
            cookie: req.headers.cookie ? 'Ada' : 'Tidak ada',
            authorization: req.headers.authorization ? 'Ada' : 'Tidak ada',
            host: req.headers.host
        });
        
        // Parse query string manual karena WebSocket URL mungkin tidak standard
        let urlParams = new URLSearchParams();
        if (req.url.includes('?')) {
            const queryString = req.url.split('?')[1];
            urlParams = new URLSearchParams(queryString);
        }
        console.log('[WebSocket] Query params:', Object.fromEntries(urlParams));
        
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

        let connection = getConnection(connectionKey);
        if (!connection) {
            // Cek lagi sebelum start monitoring (ini bisa lama)
            if (checkIfClosed()) return;
            
            await startWorkspaceMonitoring(ws.workspaceId, connectionKey, finalDeviceId);
            
            // Cek lagi setelah start monitoring
            if (checkIfClosed()) return;
            
            connection = getConnection(connectionKey);
        }

        if (connection) {
            connection.userCount = (connection.userCount || 0) + 1;
        }
        
        // Clear connection timeout setelah setup berhasil
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
        }
        
        // Final check sebelum log success
        if (checkIfClosed()) return;
        
        console.log(`[WebSocket] Koneksi berhasil di-setup untuk workspace ${ws.workspaceId}, device ${finalDeviceId}`);
        
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
            console.debug('[Uncaught Exception] RouterOS !empty reply - ini normal, bukan error.');
            return; // Jangan log sebagai error, hanya debug
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
            console.debug('[Unhandled Rejection] RouterOS !empty reply - ini normal, bukan error.');
            return; // Jangan log sebagai error
        }
        console.error('[Unhandled Rejection] RouterOS UNKNOWNREPLY error:', reason.message);
        return; // Jangan exit untuk error ini
    }
    console.error('[Unhandled Rejection] Unhandled promise rejection:', reason);
});

const PORT = process.env.PORT || 9494;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server backend berjalan di port ${PORT} dan terbuka untuk jaringan`);
    
    // Background logging - setiap 3 detik (untuk logging usage)
    cron.schedule('*/3 * * * * *', logAllActiveWorkspaces);
    
    // SLA & Notifikasi monitoring - setiap 3 detik (untuk update SLA dan notifikasi)
    // Berjalan terus menerus, tidak bergantung pada user login
    cron.schedule('*/3 * * * * *', () => {
        monitorSlaAndNotifications(broadcastToWorkspace);
    });
    
    // Dashboard snapshot - setiap 3 detik (untuk instant load dashboard)
    // Berjalan terus menerus, tidak bergantung pada user login
    cron.schedule('*/3 * * * * *', updateAllDashboardSnapshots);
    
    // Downtime notifications - setiap 30 detik (cek downtime > 2 menit dan kirim notifikasi)
    // Berjalan terus menerus, tidak bergantung pada user login
    cron.schedule('*/30 * * * * *', () => {
        sendDowntimeNotifications(broadcastToWorkspace);
    });
    
    // Daily reports - setiap hari jam 00:00
    cron.schedule('0 0 * * *', generateAndSendDailyReports, {
        timezone: "Asia/Jakarta"
    });
    
    console.log('[Cron Jobs] Background logging: setiap 3 detik');
    console.log('[Cron Jobs] SLA & Notifikasi monitoring: setiap 3 detik');
    console.log('[Cron Jobs] Dashboard snapshot: setiap 3 detik');
    console.log('[Cron Jobs] Downtime notifications: setiap 30 detik');
    console.log('[Cron Jobs] Daily reports: setiap hari jam 00:00');
});

startWhatsApp(handleCommand).catch(err => {
    console.error("Gagal memulai WhatsApp Service:", err);
});