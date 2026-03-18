const crypto = require('crypto');

// Global registry for shared physical listeners
/**
 * structure:
 * {
 *   [physicalKey]: {
 *     secretClient: RouterOSAPI,
 *     activeClient: RouterOSAPI,
 *     subscribers: Map<String, { onSecretUpdate, onActiveUpdate, onError }>,
 *     isInitializing: Promise,
 *     listeners: { secret: Stream, active: Stream }
 *   }
 * }
 */
const sharedListeners = new Map();

function getPhysicalKey(device) {
    const raw = `${device.host}:${device.port}:${device.user}:${device.password}`;
    return crypto.createHash('md5').update(raw).digest('hex');
}
async function listenToInterfaceTraffic(device, onData, onError) {
    const client = new RouterOSAPI({
        host: device.host,
        user: device.user,
        password: device.password,
        port: device.port,
        keepalive: true
    });

    try {
        await client.connect();
        console.log(`[Listener] Berhasil terhubung ke ${device.name} untuk memantau traffic.`);
        const interfaces = await client.write('/interface/print');
        const interfaceNames = interfaces.map(iface => iface.name).join(',');
        client.write('/interface/monitor-traffic', [`=interface=${interfaceNames}`, '=once='])
            .then((results) => {
                results.on('data', (data) => {
                    onData(data.attributes);
                });
                results.on('error', (err) => {
                    console.error('[Listener] Stream error:', err);
                    onError(err);
                    client.close();
                });
                results.on('done', () => {
                    console.log('[Listener] Selesai memantau.');
                    client.close();
                });
            })
            .catch(err => {
                console.error('[Listener] Gagal memulai monitor-traffic:', err);
                onError(err);
                client.close();
            });

        return client;

    } catch (error) {
        console.error(`[Listener] Gagal terhubung ke ${device.name}:`, error.message);
        onError(error);
        throw error;
    }
}

/**
 * @param {object} device
 * @param {object} options { onSecretUpdate, onActiveUpdate, onError }
 * @returns {Promise<object>} { cleanup }
 */
async function setupPppoeListeners(device, callbacks) {
    const physicalKey = getPhysicalKey(device);
    const instanceId = `${device.workspace_id}-${device.id}-${Date.now()}`;

    // 1. Dapatkan atau buat entry untuk physical listener
    if (!sharedListeners.has(physicalKey)) {
        sharedListeners.set(physicalKey, {
            subscribers: new Map(),
            isInitializing: null,
            secretClient: null,
            activeClient: null,
            listeners: { secret: null, active: null }
        });
    }

    const state = sharedListeners.get(physicalKey);
    state.subscribers.set(instanceId, callbacks);

    // 2. Inisialisasi koneksi fisik jika belum ada
    if (!state.isInitializing && !state.secretClient) {
        state.isInitializing = (async () => {
            console.log(`[Listener] Inisialisasi shared listener baru untuk: ${device.host}`);
            const createClient = () => new RouterOSAPI({
                host: device.host,
                user: device.user,
                password: device.password,
                port: device.port,
                keepalive: true,
                timeout: 0
            });

            const secretClient = createClient();
            const activeClient = createClient();
            
            try {
                await secretClient.connect();
                await activeClient.connect();

                // Setup Secret Listener
                const secretStream = await secretClient.write('/ppp/secret/listen');
                secretStream.on('data', (data) => {
                    for (const sub of state.subscribers.values()) {
                        if (sub.onSecretUpdate) sub.onSecretUpdate(data.action, data.attributes);
                    }
                });
                secretStream.on('error', (err) => {
                    console.error(`[Listener][Secret] Shared Stream error:`, err.message);
                    for (const sub of state.subscribers.values()) {
                        if (sub.onError) sub.onError(err);
                    }
                });

                // Setup Active Listener
                const activeStream = await activeClient.write('/ppp/active/listen');
                activeStream.on('data', (data) => {
                    for (const sub of state.subscribers.values()) {
                        if (sub.onActiveUpdate) sub.onActiveUpdate(data.action, data.attributes);
                    }
                });
                activeStream.on('error', (err) => {
                    console.error(`[Listener][Active] Shared Stream error:`, err.message);
                    for (const sub of state.subscribers.values()) {
                        if (sub.onError) sub.onError(err);
                    }
                });

                state.secretClient = secretClient;
                state.activeClient = activeClient;
                state.listeners.secret = secretStream;
                state.listeners.active = activeStream;
                state.isInitializing = null;

                console.log(`[Listener] Shared listener siap untuk: ${device.host}`);
            } catch (err) {
                state.isInitializing = null;
                console.error(`[Listener] Gagal inisialisasi shared listener:`, err.message);
                // Beri tahu pendaftar pertama saja atau semua?
                for (const sub of state.subscribers.values()) {
                    if (sub.onError) sub.onError(err);
                }
                sharedListeners.delete(physicalKey);
                throw err;
            }
        })();
    }

    if (state.isInitializing) {
        await state.isInitializing;
    }

    const cleanup = () => {
        state.subscribers.delete(instanceId);
        console.log(`[Listener] Subscriber ${instanceId} dilepas. Sisa: ${state.subscribers.size}`);
        
        if (state.subscribers.size === 0) {
            console.log(`[Listener] Menutup koneksi shared listener karena tidak ada subscriber tersisa.`);
            try {
                if (state.listeners.secret) state.listeners.secret.stop();
                if (state.listeners.active) state.listeners.active.stop();
                if (state.secretClient) state.secretClient.close();
                if (state.activeClient) state.activeClient.close();
            } catch (e) { /* ignore */ }
            sharedListeners.delete(physicalKey);
        }
    };

    return { cleanup };
}

module.exports = { listenToInterfaceTraffic, setupPppoeListeners };