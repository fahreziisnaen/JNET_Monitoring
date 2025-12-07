// Connection key format: "workspaceId-deviceId" atau "workspaceId" (backward compatibility)
const workspaceConnections = new Map();

// Mutex untuk mencegah race condition saat membuat koneksi baru
const connectionLocks = new Map(); // Map<connectionKey, Promise>

// Pending queue untuk request yang menunggu koneksi yang sedang dibuat
const pendingConnections = new Map(); // Map<connectionKey, Array<{resolve, reject}>>

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000;

function setIdleTimeout(connectionKey, connection, timeout) {
    if (connection.idleTimer) {
        clearTimeout(connection.idleTimer);
    }
    connection.idleTimer = setTimeout(() => {
        console.log(`[Connection Manager] Menutup koneksi idle untuk ${connectionKey} setelah ${timeout/1000} detik.`);
        if (connection.client && connection.client.connected) {
            connection.client.close();
        }
        workspaceConnections.delete(connectionKey);
    }, timeout);
}

const getConnection = (connectionKey) => {
    const conn = workspaceConnections.get(connectionKey);
    if (conn) {
        // Reset timeout setiap kali koneksi digunakan
        // Ini memastikan koneksi tidak ditutup selama masih aktif digunakan
        setIdleTimeout(connectionKey, conn, conn.timeout || DEFAULT_IDLE_TIMEOUT);
    }
    return conn;
};

const addConnection = (connectionKey, connectionData, timeout = DEFAULT_IDLE_TIMEOUT) => {
    // Pastikan timeout tidak null, undefined, atau 0 - gunakan default jika tidak valid
    const effectiveTimeout = (timeout && timeout > 0) ? timeout : DEFAULT_IDLE_TIMEOUT;
    const conn = { ...connectionData, timeout: effectiveTimeout };
    setIdleTimeout(connectionKey, conn, effectiveTimeout);
    workspaceConnections.set(connectionKey, conn);
    console.log(`[Connection Manager] Koneksi untuk ${connectionKey} didaftarkan dengan timeout ${effectiveTimeout/1000} detik.`);
    
    // Resolve semua pending requests yang menunggu koneksi ini
    const pending = pendingConnections.get(connectionKey);
    if (pending && pending.length > 0) {
        console.log(`[Connection Manager] Resolving ${pending.length} pending request(s) untuk ${connectionKey}`);
        pending.forEach(({ resolve }) => {
            try {
                resolve(conn.client);
            } catch (err) {
                console.error(`[Connection Manager] Error resolving pending request:`, err);
            }
        });
        pendingConnections.delete(connectionKey);
    }
    
    // Clear lock setelah koneksi berhasil dibuat
    connectionLocks.delete(connectionKey);
};

const removeConnection = (connectionKey) => {
    const connection = workspaceConnections.get(connectionKey);
    if (connection) {
        console.log(`[Connection Manager] Menghapus koneksi untuk ${connectionKey}`);
        clearTimeout(connection.idleTimer);
        if (connection.client && connection.client.connected) {
            connection.client.close().catch(err => console.error("Error saat menutup koneksi:", err));
        }
        workspaceConnections.delete(connectionKey);
    }
    
    // Reject semua pending requests jika koneksi dihapus
    const pending = pendingConnections.get(connectionKey);
    if (pending && pending.length > 0) {
        console.log(`[Connection Manager] Rejecting ${pending.length} pending request(s) untuk ${connectionKey} karena koneksi dihapus`);
        pending.forEach(({ reject }) => {
            try {
                reject(new Error('Koneksi dihapus sebelum selesai dibuat'));
            } catch (err) {
                console.error(`[Connection Manager] Error rejecting pending request:`, err);
            }
        });
        pendingConnections.delete(connectionKey);
    }
    
    // Clear lock jika ada
    connectionLocks.delete(connectionKey);
};

/**
 * Tambahkan request ke pending queue untuk menunggu koneksi yang sedang dibuat
 */
const addPendingRequest = (connectionKey, resolve, reject) => {
    if (!pendingConnections.has(connectionKey)) {
        pendingConnections.set(connectionKey, []);
    }
    pendingConnections.get(connectionKey).push({ resolve, reject });
};

/**
 * Cek apakah ada koneksi yang sedang dibuat (ada lock)
 */
const isConnectionLocked = (connectionKey) => {
    return connectionLocks.has(connectionKey);
};

/**
 * Set lock untuk koneksi yang sedang dibuat
 */
const setConnectionLock = (connectionKey, promise) => {
    connectionLocks.set(connectionKey, promise);
};

/**
 * Get lock promise untuk koneksi yang sedang dibuat
 */
const getConnectionLock = (connectionKey) => {
    return connectionLocks.get(connectionKey);
};

/**
 * Clear lock yang hang (untuk recovery dari deadlock)
 */
const clearConnectionLock = (connectionKey) => {
    if (connectionLocks.has(connectionKey)) {
        console.warn(`[Connection Manager] Clearing hang lock untuk ${connectionKey}`);
        connectionLocks.delete(connectionKey);
    }
};

module.exports = {
    getConnection,
    addConnection,
    removeConnection,
    setIdleTimeout, // Export untuk update timeout koneksi yang sudah ada
    addPendingRequest,
    isConnectionLocked,
    setConnectionLock,
    getConnectionLock,
    clearConnectionLock,
};