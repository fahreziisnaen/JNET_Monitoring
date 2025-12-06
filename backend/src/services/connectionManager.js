// Connection key format: "workspaceId-deviceId" atau "workspaceId" (backward compatibility)
const workspaceConnections = new Map();

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
    const conn = { ...connectionData, timeout };
    setIdleTimeout(connectionKey, conn, timeout);
    workspaceConnections.set(connectionKey, conn);
    console.log(`[Connection Manager] Koneksi untuk ${connectionKey} didaftarkan dengan timeout ${timeout/1000} detik.`);
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
};

module.exports = {
    getConnection,
    addConnection,
    removeConnection,
    setIdleTimeout, // Export untuk update timeout koneksi yang sudah ada
};