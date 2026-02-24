/**
 * MikrotikStore - Singleton store untuk menyimpan data real-time dari listener
 * Digunakan agar Controller bisa melakukan lookup instan tanpa query API berat.
 */

const workspaceSecrets = new Map(); // Map<workspaceId, secrets[]>
const workspaceActive = new Map();  // Map<workspaceId, active[]>
const deviceStatus = new Map();     // Map<workspaceId_deviceId, status>

module.exports = {
    setDeviceStatus: (workspaceId, deviceId, status) => {
        deviceStatus.set(`${workspaceId}_${deviceId}`, status);
    },

    getDeviceStatus: (workspaceId, deviceId) => {
        return deviceStatus.get(`${workspaceId}_${deviceId}`) || 'connected';
    },

    setSecrets: (workspaceId, secrets) => {
        workspaceSecrets.set(String(workspaceId), secrets);
    },

    getSecrets: (workspaceId) => {
        return workspaceSecrets.get(String(workspaceId)) || [];
    },

    updateSecret: (workspaceId, action, attributes) => {
        const id = String(workspaceId);
        let secrets = workspaceSecrets.get(id) || [];

        if (action === 'add' || action === 'change') {
            const index = secrets.findIndex(s => s['.id'] === attributes['.id'] || s.name === attributes.name);
            if (index !== -1) {
                secrets[index] = { ...secrets[index], ...attributes };
            } else {
                secrets.push(attributes);
            }
        } else if (action === 'remove') {
            secrets = secrets.filter(s => s['.id'] !== attributes['.id'] && s.name !== attributes.name);
        }

        workspaceSecrets.set(id, secrets);
    },

    setActive: (workspaceId, active) => {
        workspaceActive.set(String(workspaceId), active);
    },

    getActive: (workspaceId) => {
        return workspaceActive.get(String(workspaceId)) || [];
    },

    clear: (workspaceId) => {
        workspaceSecrets.delete(String(workspaceId));
        workspaceActive.delete(String(workspaceId));
        // Note: We don't clear deviceStatus here as it tracks physical connection state independent of data dumps
    }
};
