const WebSocket = require('ws');

let wss = null;

const init = (webSocketServer) => {
    wss = webSocketServer;
};

const broadcastTargeted = (workspaceId, deviceId, data) => {
    if (!wss) return 0;
    
    let sentCount = 0;
    wss.clients.forEach((client) => {
        const isDeviceMatch = !deviceId || client.deviceId == deviceId;
        if (client.workspaceId == workspaceId && isDeviceMatch && client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(data));
                sentCount++;
            } catch (error) {
                // Ignore send errors
            }
        }
    });
    return sentCount;
};

const broadcastSinglePppoeUpdate = (workspaceId, deviceId, secretName) => {
    const mikrotikStore = require('./mikrotikStore');
    const pppoeSecrets = mikrotikStore.getSecrets(workspaceId, deviceId) || [];
    const activeUsers = mikrotikStore.getActive(workspaceId, deviceId) || [];
    
    const secret = pppoeSecrets.find(s => s.name === secretName);
    if (!secret) return;

    const activeInfo = activeUsers.find(u => u.name === secretName);
    const isActive = !!activeInfo;
    
    const deviceInfo = mikrotikStore.getDeviceInfo(workspaceId, deviceId);
    
    const enriched = { 
        ...secret, 
        deviceId, 
        isActive,
        router_name: deviceInfo.name,
        workspace_name: deviceInfo.workspaceName
    };
    if (isActive) {
        if (activeInfo.uptime) enriched.uptime = activeInfo.uptime;
        if (activeInfo['.id']) enriched.activeConnectionId = activeInfo['.id'];
        if (activeInfo.address) {
            enriched.currentAddress = activeInfo.address;
            if (!enriched['remote-address']) enriched['remote-address'] = activeInfo.address;
        }
    }

    broadcastTargeted(workspaceId, deviceId, {
        type: 'pppoe-single-update',
        payload: { secret: enriched }
    });
};

const broadcastSinglePppoeRemove = (workspaceId, deviceId, secretName) => {
    broadcastTargeted(workspaceId, deviceId, {
        type: 'pppoe-single-remove',
        payload: { name: secretName }
    });
};

module.exports = {
    init,
    broadcastTargeted,
    broadcastSinglePppoeUpdate,
    broadcastSinglePppoeRemove
};
