/**
 * MikrotikStore - Singleton store untuk menyimpan data real-time dari listener
 * Digunakan agar Controller bisa melakukan lookup instan tanpa query API berat.
 */

const workspaceSecrets = new Map(); // Map<workspaceId_deviceId, secrets[]>
const workspaceActive = new Map();  // Map<workspaceId_deviceId, active[]>
const workspaceHotspotActive = new Map(); // Map<workspaceId_deviceId, hotspotActive[]>
const deviceStatus = new Map();     // Map<workspaceId_deviceId, status>

module.exports = {
    setDeviceStatus: (workspaceId, deviceId, status) => {
        deviceStatus.set(`${workspaceId}_${deviceId}`, status);
    },

    getDeviceStatus: (workspaceId, deviceId) => {
        return deviceStatus.get(`${workspaceId}_${deviceId}`) || 'connected';
    },

    setSecrets: (workspaceId, deviceId, secrets) => {
        workspaceSecrets.set(`${workspaceId}_${deviceId}`, secrets);
    },

    getSecrets: (workspaceId, deviceId) => {
        return workspaceSecrets.get(`${workspaceId}_${deviceId}`) || [];
    },

    updateSecret: (workspaceId, deviceId, action, attributes) => {
        const id = `${workspaceId}_${deviceId}`;
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

    setActive: (workspaceId, deviceId, active) => {
        workspaceActive.set(`${workspaceId}_${deviceId}`, active);
    },

    getActive: (workspaceId, deviceId) => {
        return workspaceActive.get(`${workspaceId}_${deviceId}`) || [];
    },

    setHotspotActive: (workspaceId, deviceId, hotspotActive) => {
        workspaceHotspotActive.set(`${workspaceId}_${deviceId}`, hotspotActive);
    },

    getHotspotActive: (workspaceId, deviceId) => {
        return workspaceHotspotActive.get(`${workspaceId}_${deviceId}`) || [];
    },

    clear: (workspaceId, deviceId) => {
        const id = `${workspaceId}_${deviceId}`;
        workspaceSecrets.delete(id);
        workspaceActive.delete(id);
        // Note: We don't clear deviceStatus here as it tracks physical connection state independent of data dumps
    }
};
