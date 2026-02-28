require('dotenv').config();
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const axios = require('axios');

const API_URL = process.env.JNET_API_URL || 'http://localhost:9494';
const API_KEY = process.env.JNET_API_KEY;

if (!API_KEY) {
    console.error('Error: JNET_API_KEY environment variable is required.');
    process.exit(1);
}

// Check if trying to run node directly without stdio
if (process.stdin.isTTY) {
    console.error("This is an MCP server meant to be run via a Model Context Protocol client.");
    console.error("It communicates via stdio, not interactively.");
    console.error("To use it with OpenClaw, configure the tools to run this script directly.");
    process.exit(1);
}

// Initialize the API client
const jnetClient = axios.create({
    baseURL: API_URL,
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    },
    // Prevent unhandled promise rejections on 4xx/5xx status codes
    validateStatus: () => true
});

// Create the MCP Server
const server = new McpServer({
    name: 'JNET-Monitoring-MCP',
    version: '1.0.0'
});

console.error(`Attempting to start MCP server connecting to ${API_URL}`);

/**
 * Common Zod Schema definitions for arguments
 */
const DeviceIdSchema = {
    deviceId: z.number().describe('The ID of the MikroTik device (e.g., 1)')
};

// ==========================================
// Tool: get_devices
// ==========================================
server.tool(
    'get_devices',
    'Get a list of all MikroTik devices managed in the workspace.',
    {},
    async () => {
        try {
            const response = await jnetClient.get('/api/devices');

            if (response.status !== 200) {
                return {
                    content: [{
                        type: 'text',
                        text: `API Error (${response.status}): ${response.data.message || 'Failed to fetch devices'}`
                    }],
                    isError: true
                };
            }

            const devices = response.data;
            let resultText = "Found " + devices.length + " Mikrotik devices:\n";
            devices.forEach(d => {
                resultText += `- ID: ${d.id} | Name: ${d.name} | Host: ${d.host}:${d.port}\n`;
            });

            return {
                content: [{ type: 'text', text: resultText }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Connection error: ${error.message}` }],
                isError: true
            };
        }
    }
);

// ==========================================
// Tool: get_offline_pppoe_users
// ==========================================
server.tool(
    'get_offline_pppoe_users',
    'Get a list of currently OFFLINE (disconnected) PPPoE users for a specific MikroTik device.',
    DeviceIdSchema,
    async ({ deviceId }) => {
        try {
            // Fetch all PPPoE secrets (accounts)
            const secretsResponse = await jnetClient.get(`/api/pppoe/secrets?deviceId=${deviceId}`);

            if (secretsResponse.status !== 200) {
                return {
                    content: [{ type: 'text', text: `API Error: ${secretsResponse.data.message || 'Failed to fetch PPPoE secrets'}` }],
                    isError: true
                };
            }

            const allSecrets = secretsResponse.data;

            if (!Array.isArray(allSecrets)) {
                return { content: [{ type: 'text', text: 'Error: Unexpected response format from API' }], isError: true };
            }

            // A PPPoE user is offline if they don't have an 'active' object property attached to them (based on JNET backend logic mapping)
            const offlineUsers = allSecrets.filter(secret => !secret.active);

            if (offlineUsers.length === 0) {
                return {
                    content: [{ type: 'text', text: `No offline PPPoE users found on device ID ${deviceId}. Everyone is connected!` }]
                };
            }

            let resultText = `**Offline PPPoE Users (${offlineUsers.length}) on Device ID ${deviceId}**\n\n`;

            // Show only first 50 to avoid token limits
            offlineUsers.slice(0, 50).forEach(u => {
                const status = u.disabled === 'true' ? '(DISABLED)' : '';
                resultText += `- **User**: ${u.name} ${status} | **Profile**: ${u.profile}\n`;
            });

            if (offlineUsers.length > 50) {
                resultText += `\n*(Showing top 50 out of ${offlineUsers.length} offline users)*`;
            }

            return {
                content: [{ type: 'text', text: resultText }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Connection error finding offline users: ${error.message}` }],
                isError: true
            };
        }
    }
);

// ==========================================
// Tool: get_device_stats
// ==========================================
server.tool(
    'get_device_stats',
    'Get the real-time resource statistics (CPU, RAM, Disk) for a specific MikroTik device.',
    DeviceIdSchema,
    async ({ deviceId }) => {
        try {
            const response = await jnetClient.get(`/api/dashboard/snapshot?deviceId=${deviceId}`);

            if (response.status !== 200) {
                return {
                    content: [{
                        type: 'text',
                        text: `API Error (${response.status}): ${response.data.message || 'Failed to fetch stats'}`
                    }],
                    isError: true
                };
            }

            const data = response.data;
            if (!data.resources) {
                return {
                    content: [{ type: 'text', text: `No resource stats found for device ID ${deviceId}. The device might be offline.` }],
                    isError: true
                };
            }

            const res = data.resources;
            const memoryPercent = ((res.memory.total - res.memory.free) / res.memory.total * 100).toFixed(1);
            const diskPercent = ((res.hdd.total - res.hdd.free) / res.hdd.total * 100).toFixed(1);

            const resultText = `
**Device stats for ID ${deviceId}**
- **Board Name**: ${res.boardName} (${res.architectureName})
- **RouterOS Version**: ${res.version}
- **CPU Load**: ${res.cpu.load}%
- **Memory Usage**: ${memoryPercent}% (${(res.memory.total / 1024 / 1024).toFixed(1)} MB Total)
- **Disk Usage**: ${diskPercent}%
- **Uptime**: ${res.uptime}
`;

            return {
                content: [{ type: 'text', text: resultText.trim() }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Connection error: ${error.message}` }],
                isError: true
            };
        }
    }
);

// ==========================================
// Tool: get_active_pppoe_users
// ==========================================
server.tool(
    'get_active_pppoe_users',
    'Get a list of currently active (connected) PPPoE users for a specific MikroTik device.',
    DeviceIdSchema,
    async ({ deviceId }) => {
        try {
            const response = await jnetClient.get(`/api/dashboard/snapshot?deviceId=${deviceId}`);

            if (response.status !== 200) {
                return {
                    content: [{
                        type: 'text',
                        text: `API Error (${response.status}): ${response.data.message || 'Failed to fetch active PPPoE'}`
                    }],
                    isError: true
                };
            }

            const data = response.data;
            const activeUsers = data.pppoeActive || [];

            if (activeUsers.length === 0) {
                return {
                    content: [{ type: 'text', text: `No active PPPoE users right now on device ID ${deviceId}.` }]
                };
            }

            let resultText = `**Active PPPoE Users (${activeUsers.length}) on Device ID ${deviceId}**\n\n`;
            activeUsers.slice(0, 50).forEach(u => {
                resultText += `- **User**: ${u.name} | **IP**: ${u.address} | **Uptime**: ${u.uptime}\n`;
            });

            if (activeUsers.length > 50) {
                resultText += `\n*(Showing top 50 out of ${activeUsers.length} active users)*`;
            }

            return {
                content: [{ type: 'text', text: resultText.trim() }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Connection error: ${error.message}` }],
                isError: true
            };
        }
    }
);

// ==========================================
// Tool: get_network_assets
// ==========================================
server.tool(
    'get_network_assets',
    'Get a list of all network assets (Mikrotik, OLT, ODC, ODP) and their connection status.',
    {},
    async () => {
        try {
            const response = await jnetClient.get('/api/assets');

            if (response.status !== 200) {
                return {
                    content: [{
                        type: 'text',
                        text: `API Error (${response.status}): ${response.data.message || 'Failed to fetch assets'}`
                    }],
                    isError: true
                };
            }

            const assets = response.data.data || [];
            if (assets.length === 0) {
                return {
                    content: [{ type: 'text', text: `No network assets found.` }]
                };
            }

            let resultText = `**Network Assets (${assets.length})**\n\n`;

            // Group by type for easier reading
            const types = ['Mikrotik', 'OLT', 'ODC', 'ODP'];

            types.forEach(type => {
                const typeAssets = assets.filter(a => a.type === type);
                if (typeAssets.length > 0) {
                    resultText += `### ${type} (${typeAssets.length})\n`;
                    typeAssets.forEach(a => {
                        const statusStr = a.connection_status ? `[${a.connection_status}]` : '';
                        resultText += `- ${a.name} ${statusStr} (ID: ${a.id})\n`;
                    });
                    resultText += '\n';
                }
            });

            return {
                content: [{ type: 'text', text: resultText.trim() }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Connection error: ${error.message}` }],
                isError: true
            };
        }
    }
);


// ==========================================
// Tool: list_jnet_endpoints
// ==========================================
server.tool(
    'list_jnet_endpoints',
    'Get a comprehensive directory of all available JNET Backend API endpoints that are READ-ONLY. Use this to discover what data you can fetch with call_jnet_api.',
    {},
    async () => {
        const endpoints = `
** JNET Monitoring API Endpoints Directory (STRICTLY READ-ONLY) **
(Use the 'call_jnet_api' tool to execute these endpoints)

# DEVICES
GET /api/devices - List all mikrotik devices
GET /api/devices/:id - Get specific device details

# IP POOLS
GET /api/ip-pools?deviceId={id} - List all IP Pools on the device

# BOT (WhatsApp)
GET /api/bot/groups - Get WhatsApp groups
GET /api/bot/qr - Check WhatsApp bot QR/Status

# DASHBOARD
GET /api/dashboard/snapshot?deviceId={id} - Get device resource stats

# CLIENTS
GET /api/clients - Get all clients
GET /api/clients/:id - Get specific client
GET /api/clients/unlinked-pppoe-secrets - Find unlinked pppoe

# REPORTS
GET /api/reports/monthly?month={mm}&year={yyyy} - Generate monthly report

# BACKUP
GET /api/backup/export - Export backup

# NOC (Safe aggregated queries that use POST)
POST /api/noc/map - Get aggregated map data (body: empty or filters)
POST /api/noc/secrets - Get aggregated secret data (body: empty or filters)

# ASSETS
GET /api/assets - Get all network assets
GET /api/assets/unconnected-pppoe-users
GET /api/assets/workspace-users
GET /api/assets/owners

# HOTSPOT
GET /api/hotspot/summary?deviceId={id}
GET /api/hotspot/profiles?deviceId={id}

# PPPOE
GET /api/pppoe/summary?deviceId={id}
GET /api/pppoe/secrets?deviceId={id}
GET /api/pppoe/profiles?deviceId={id}
GET /api/pppoe/next-ip?poolName={name}&deviceId={id}
GET /api/pppoe/secrets/:name/sla?deviceId={id}
GET /api/pppoe/secrets/:name/usage?deviceId={id}

# WORKSPACE
GET /api/workspaces/all - List all workspaces
GET /api/workspaces/all-users - List all users in application
GET /api/workspaces/me - Current workspace info
GET /api/workspaces/interfaces?deviceId={id} - Available interfaces
GET /api/workspaces/interfaces-by-device?deviceId={id}
GET /api/workspaces/members - List members

# SYSTEM & SECURITY
GET /api/sessions - List active user login sessions
GET /api/auth/me - Get current logged-in user profile
GET /api/api-keys - List generated API keys

ALL MUTATING METHODS (POST, PUT, PATCH, DELETE) ARE STRICTLY BLOCKED AND FORBIDDEN, EXCEPT FOR STRICTLY APPROVED SAFE POST QUERIES LISTED ABOVE. YOU CAN ONLY VIEW DATA BEYOND THIS POINT.
`;
        return { content: [{ type: 'text', text: endpoints.trim() }] };
    }
);

// ==========================================
// Tool: call_jnet_api
// ==========================================
server.tool(
    'call_jnet_api',
    'Execute ANY READ-ONLY JNET backend API endpoint. Use list_jnet_endpoints first if you are unsure of the path.',
    {
        method: z.enum(['GET', 'POST']).describe('The HTTP method. Default is GET. Only safe whitelisted POST methods are allowed.'),
        endpoint: z.string().describe('The API endpoint path (e.g., /api/pppoe/summary)'),
        queryParams: z.string().optional().describe('Optional JSON-stringified object for query string (e.g. \'{"deviceId":1}\')'),
        body: z.string().optional().describe('Optional JSON-stringified object payload for safe POST requests')
    },
    async ({ method, endpoint, queryParams, body }) => {
        try {
            if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;

            // Strict Read-Only Security Enforcement
            if (method.toUpperCase() === 'POST') {
                const allowedPosts = ['/api/noc/map', '/api/noc/secrets'];
                if (!allowedPosts.includes(endpoint)) {
                    return { content: [{ type: 'text', text: `Error: STRICTLY READ-ONLY MODE. POST method to endpoint '${endpoint}' is forbidden because it is not whitelisted for safety.` }], isError: true };
                }
            } else if (method.toUpperCase() !== 'GET') {
                return { content: [{ type: 'text', text: `Error: STRICTLY READ-ONLY MODE. Modifying HTTP methods like ${method} are strictly forbidden.` }], isError: true };
            }

            let parsedQuery = undefined;
            if (queryParams) {
                try { parsedQuery = JSON.parse(queryParams); } catch (e) { parsedQuery = undefined; }
            }

            let parsedBody = undefined;
            if (body) {
                try { parsedBody = JSON.parse(body); } catch (e) { parsedBody = undefined; }
            }

            const config = {
                method: method,
                url: endpoint,
                params: parsedQuery,
                data: parsedBody
            };

            const response = await jnetClient.request(config);

            let responseText = `Status: ${response.status} ${response.statusText}\n\n`;

            if (typeof response.data === 'object') {
                responseText += JSON.stringify(response.data, null, 2);
            } else {
                responseText += response.data;
            }

            if (responseText.length > 50000) {
                responseText = responseText.substring(0, 50000) + '\n\n...[TRUNCATED DUE TO MAX TOKENS SIZE]...';
            }

            return {
                content: [{ type: 'text', text: responseText }],
                isError: response.status >= 400
            };
        } catch (error) {
            // Include backend error message if available
            let errorMsg = `Connection error executing ${method} ${endpoint}: ${error.message}`;
            if (error.response && error.response.data) {
                errorMsg += `\nBackend Error: ${JSON.stringify(error.response.data)}`;
            }
            return {
                content: [{ type: 'text', text: errorMsg }],
                isError: true
            };
        }
    }
);

/**
 * Main execution
 */
async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('JNET Monitoring MCP Server running on stdio');
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

main();
