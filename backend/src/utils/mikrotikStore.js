/**
 * MikrotikStore - Singleton store untuk menyimpan data real-time dari listener
 * Digunakan agar Controller bisa melakukan lookup instan tanpa query API berat.
 */

const workspaceSecrets = new Map(); // Map<workspaceId_deviceId, secrets[]>
const workspaceActive = new Map();  // Map<workspaceId_deviceId, active[]>
const deviceStatus = new Map();     // Map<workspaceId_deviceId, status>
const deviceResource = new Map();   // Map<workspaceId_deviceId, resource{}>
const deviceInfo = new Map();       // Map<workspaceId_deviceId, { name, workspaceName }>

module.exports = {
    setDeviceInfo: (workspaceId, deviceId, info) => {
        deviceInfo.set(`${workspaceId}_${deviceId}`, info);
    },

    getDeviceInfo: (workspaceId, deviceId) => {
        return deviceInfo.get(`${workspaceId}_${deviceId}`) || {};
    },
    setDeviceStatus: (workspaceId, deviceId, status) => {
        deviceStatus.set(`${workspaceId}_${deviceId}`, status);
    },

    getDeviceStatus: (workspaceId, deviceId) => {
        return deviceStatus.get(`${workspaceId}_${deviceId}`) || 'disconnected';
    },

    setResource: (workspaceId, deviceId, resource) => {
        deviceResource.set(`${workspaceId}_${deviceId}`, resource);
    },

    getResource: (workspaceId, deviceId) => {
        return deviceResource.get(`${workspaceId}_${deviceId}`) || {};
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


    getSecretsKeys: () => {
        return Array.from(workspaceSecrets.keys());
    },
    clear: (workspaceId, deviceId) => {
        const id = `${workspaceId}_${deviceId}`;
        workspaceSecrets.delete(id);
        workspaceActive.delete(id);
        deviceResource.delete(id);
        deviceStatus.delete(id);
    }
};
