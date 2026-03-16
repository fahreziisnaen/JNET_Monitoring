# JNET Monitoring - AI Coding Assistant Instructions

## Architecture Overview

JNET Monitoring is a full-stack web application for monitoring and managing MikroTik routers with real-time dashboards, user management, and WhatsApp integration.

**Backend (Node.js/Express):**
- REST API with JWT + WhatsApp OTP authentication
- WebSocket server for real-time updates (`/ws`)
- Multi-workspace isolation with RBAC (Owner/Admin/User/Super Admin)
- Cron jobs for automated monitoring and notifications
- MCP server for AI tool integration

**Frontend (Next.js 15):**
- App Router with TypeScript
- Real-time WebSocket connections
- Interactive Leaflet maps with custom markers
- Chart.js for data visualization
- File uploads with cropping (avatars, assets, clients)

**Database (MySQL):**
- Workspace-based data isolation
- Historical logging (resource_logs, pppoe_usage_logs)
- SLA tracking and downtime events

## Critical Development Workflows

### Local Development Setup
```bash
# Backend
cd backend
npm install
# Create .env with DB credentials
npm run dev  # Runs on http://localhost:9494

# Frontend
cd next
npm install
# Create .env.local with API URLs
npm run dev  # Runs on http://localhost:3000
```

### Database Initialization
```bash
mysql -u root -p < backend/database_setup.sql
```

### Production Deployment
- Use PM2: `pm2 start server.js --name jnet-monitoring-api`
- Nginx reverse proxy required
- WhatsApp session files stored in `backend/whatsapp_auth_info/`

### WhatsApp Integration
- QR pairing via dashboard settings
- Group notifications for alerts
- OTP authentication for login/registration
- Session persistence with auto-restart

## Project-Specific Patterns

### Authentication & Security
- JWT tokens stored in httpOnly cookies
- WhatsApp OTP bypass when WA service unavailable (development convenience)
- Session tracking with IP/User-Agent validation
- CORS configured per environment

### File Uploads
- Stored in `backend/public/uploads/` subdirectories
- Naming convention: `asset-<name>` for network assets
- Automatic cleanup of orphaned files
- Multer middleware with size limits

### WebSocket Communication
```javascript
// Broadcasting to workspace
broadcastToWorkspace(workspaceId, deviceId, {
  type: 'pppoe_user_update',
  data: userData
});
```
- Client connections tagged with `workspaceId` and `deviceId`

### Database Queries
- Always include workspace isolation: `WHERE workspace_id = ?`
- Use connection pooling from `src/config/database`
- Foreign key constraints with CASCADE deletes

### Error Handling
- Production logging disabled except errors
- Graceful degradation (e.g., WhatsApp offline bypass)
- Client-side offline detection with `BackendOfflineOverlay`

### API Response Patterns
```javascript
// Success
res.json({ success: true, data: result });

// Error
res.status(400).json({ message: 'Error description' });
```

## Key Files & Directories

- `backend/server.js` - Main server with WebSocket setup
- `backend/src/routes/` - REST API endpoints
- `backend/src/controllers/` - Business logic
- `backend/src/services/` - External integrations (WhatsApp, MikroTik)
- `backend/src/bot/` - Automated tasks and monitoring
- `next/src/app/(main)/` - Protected routes
- `next/src/components/providers/` - React context providers
- `backend/database_setup.sql` - Complete schema with migrations

## Integration Points

### MikroTik API
- `node-routeros` for RouterOS commands
- Connection pooling in `mikrotikStore`
- Real-time listeners for PPPoE events

### WhatsApp Gateway
- Baileys library for WhatsApp Web API
- Persistent sessions with QR pairing
- Group messaging for notifications

### MCP Server
- `backend/mcp-server.js` for AI tool integration
- API key authentication
- Tools for device monitoring and user management

### Maps & Assets
- Leaflet with react-leaflet
- Custom markers with status indicators
- KML import/export for network assets
- SMIL animations for traffic flow visualization

## Common Gotchas

- **Workspace Isolation**: Always filter queries by `workspace_id`
- **WhatsApp Sessions**: Persist `whatsapp_auth_info/` directory
- **WebSocket Cleanup**: Remove connections on logout
- **File Paths**: Use absolute paths for file operations
- **Environment Variables**: Required for DB, JWT, CORS origins
- **Production Logging**: Disabled in production except errors
- **Database Timezone**: Set to Asia/Jakarta (UTC+7)

## Development Tips

- Use `npm run dev` in both backend and next directories
- Check WebSocket connections in browser dev tools
- Monitor database logs for query performance
- Test WhatsApp integration with separate number
- Use workspace-specific localStorage keys for caching</content>
<parameter name="filePath">e:/programming/JNET Monitoring/.github/copilot-instructions.md