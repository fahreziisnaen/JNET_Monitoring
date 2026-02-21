const RouterOSAPI = require('node-routeros').RouterOSAPI;

/**
 * @param {object} device
 * @param {function} onData
 * @param {function} onError
 * @returns {Promise<RouterOSAPI>}
 */
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
 * @returns {Promise<object>} { secretListener, activeListener, closeAll }
 */
async function setupPppoeListeners(device, { onSecretUpdate, onActiveUpdate, onError }) {
    const createClient = () => new RouterOSAPI({
        host: device.host,
        user: device.user,
        password: device.password,
        port: device.port,
        keepalive: true,
        timeout: 0 // Disable timeout for long-lived listen connection
    });

    const secretClient = createClient();
    const activeClient = createClient();

    const listeners = {
        secret: null,
        active: null
    };

    const cleanup = () => {
        try {
            if (listeners.secret) listeners.secret.stop();
            if (listeners.active) listeners.active.stop();
            secretClient.close();
            activeClient.close();
        } catch (e) { /* ignore */ }
    };

    try {
        const setupPromise = (async () => {
            await secretClient.connect();
            await activeClient.connect();

            // 1. Listen Secrets
            const secretStream = await secretClient.write('/ppp/secret/listen');
            secretStream.on('data', (data) => {
                // data.action: 'add', 'remove', 'change'
                // data.attributes: { .id, name, profile, ... }
                onSecretUpdate(data.action, data.attributes);
            });
            secretStream.on('error', (err) => {
                console.error(`[Listener][Secret] Stream error:`, err.message);
                onError(err);
            });
            listeners.secret = secretStream;

            // 2. Listen Active Connections
            const activeStream = await activeClient.write('/ppp/active/listen');
            activeStream.on('data', (data) => {
                onActiveUpdate(data.action, data.attributes);
            });
            activeStream.on('error', (err) => {
                console.error(`[Listener][Active] Stream error:`, err.message);
                onError(err);
            });
            listeners.active = activeStream;

            console.log(`[Listener] Listeners aktif untuk ${device.name}`);
            return { cleanup };
        })();

        // Beri timeout 5 detik untuk inisialisasi listener agar tidak bikin WS connection hang
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout inisialisasi listener')), 5000)
        );

        return await Promise.race([setupPromise, timeoutPromise]);

    } catch (error) {
        cleanup();
        throw error;
    }
}

module.exports = { listenToInterfaceTraffic, setupPppoeListeners };