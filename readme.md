# JNET MONITORING TOOLS
<h3 align="center">A modern, web-based dashboard for monitoring and managing MikroTik routers.</h3>

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

JNET Monitoring is a full-stack application designed to provide an intuitive and powerful interface for managing MikroTik devices. It combines a real-time monitoring dashboard with comprehensive management tools for PPPoE, Hotspot, and network assets, enhanced with WhatsApp integration for OTP authentication and automated notifications.

---

## ✨ Key Features

### 📊 Real-time Monitoring
* **Dashboard**: Monitor CPU, RAM, disk usage, and interface traffic in real-time via WebSocket
* **Resource Monitoring**: Track system resources with live charts and graphs
* **Traffic Analysis**: View interface traffic statistics with detailed bandwidth information
* **Active Users**: Monitor active PPPoE and Hotspot users in real-time
* **Historical Data Logging**:
  - **Resource Logs**: CPU and Memory usage logged every 3 seconds for historical analysis
  - **PPPoE Usage Logs**: Daily usage tracking (upload, download, total bytes) per user
  - **Dashboard Snapshot**: Cached dashboard data for instant loading
* **Data Persistence**: Chart data persisted in localStorage with workspace-specific keys

### 👥 User & PPPoE Management
* **PPPoE Management**: 
  - View, add, edit, delete, disable, and kick active PPPoE users
  - Search and filter PPPoE secrets
  - View uptime for active users
  - Auto-kick users when profile is changed or secret is disabled
* **Hotspot Management**: Complete CRUD operations for Hotspot users
* **IP Pool Management**: Automatically assign IP addresses to new PPPoE users based on profiles
  - Auto-populate IP start, IP end, and gateway when profile is selected
  - Link IP pools to PPPoE profiles
  - **Sync from MikroTik**: One-click synchronization to import IP pools from MikroTik devices
* **Orphan Client Detection**: Automatically detect PPPoE clients that exist in the database but not on MikroTik (marked as "ORPHAN" and sorted to top)

### 🗺️ Network Asset Mapping
* **Interactive Map**: Visualize your network infrastructure (MikroTik, OLT, ODC, ODP) on an interactive Leaflet map
* **Client Mapping**: Display clients (PPPoE users) on the map with connection lines to ODPs
* **Custom Connection Paths**: Draw multi-waypoint polyline routes between assets (drag-to-edit)
* **Real-time Map Status**:
  - **Dynamic Markers**: Client and ODP markers update status instantly via WebSocket (no refresh needed)
  - **SMIL Flow Animation**: Native SVG `<animate>` tags injected directly into map polylines to visualize active traffic flow (production-safe, no CSS dependency)
  - **Auto-ODP State**: ODP markers turn red automatically if all connected clients are offline
* **KML Import/Export**: Import network assets from KML files and export for backup
* **Asset Management**: 
  - Manage network assets (MikroTik, OLT, ODC, ODP) with coordinates
  - Filter assets by owner
  - View detailed asset information with connected clients/users
  - **Asset Photos**: Upload and view physical photos (ODP, ODC, OLT) for field identification with custom naming (`asset-<name>`)
  - **FullScreen Preview**: Click thumbnails to view high-resolution, uncropped asset photos
  - **Automated Cleanup**: System automatically deletes orphaned photo files when assets are updated or removed
* **Client Management**:
  - Link PPPoE secrets to clients with location coordinates
  - Connect clients to ODP assets
  - **Client Photos**: Upload profile photos for clients
  - View client details with clickable remote IP addresses and Google Maps links

### 📈 SLA & Downtime Tracking
* **SLA Monitoring**: Track user uptime and generate Service Level Agreement reports
* **Usage Statistics**: 
  - Daily usage: Data usage for today only
  - 7 Days usage: Total data usage for the last 7 days (including today)
  - 30 Days usage: Total data usage for the last 30 days (including today)
  - Accurate calculation from `pppoe_usage_logs` table
* **Downtime Events**: 
  - Automatic detection of user disconnections
  - Track downtime duration with detailed timestamps
  - Format downtime duration as "x hari x jam x menit x detik"

### 📄 Report Generation
* **Monthly PDF Reports**: Generate comprehensive monthly reports in PDF format
* **Simplified Report Generation**:
  - Select year and month
  - Select one or more MikroTik devices
  - No need to select interfaces — automatically includes all device statistics
* **Report Sections**:
  - SLA & Downtime statistics
  - Device Statistics per MikroTik (CPU, Memory, log entries)
  - Client Statistics per device (usage, downtime, events)
* **Beautiful PDF Formatting**: Professional tables with repeating headers, alternating row colors, pagination, and info boxes

### 🔔 Notification System
* **Downtime Notifications**: WhatsApp + WebSocket toast when user disconnects for 2+ minutes
* **Reconnect Notifications**: WhatsApp + WebSocket toast when user reconnects after 2+ min downtime
* **Gateway Connection Alerts**: Real-time toasts in dashboard when MikroTik device connects/disconnects
* **System Alerts**: High CPU usage, device offline notifications

### 📱 WhatsApp Gateway (Always-On)
* **OTP Authentication**: Two-factor login and registration via WhatsApp OTP
* **Password Reset**: Forgot password flow sends OTP via WhatsApp
* **Automated Notifications**: Downtime/reconnect alerts sent to configured WhatsApp group
* **QR Pairing**: Scan QR code from dashboard to pair WhatsApp number
* **Group Management**: Select target WhatsApp group from dropdown in settings
* **Super Admin Global Control**: Centralized WhatsApp management for all workspaces
* **Test Message**: Send test messages to verify group configuration

### 🔐 Security & Authentication
* **Two-Factor Authentication**: OTP sent via WhatsApp for secure login & registration
* **JWT Authentication**: Secure cookie-based token authentication with session verification
* **Forgot Password**: Password reset via WhatsApp OTP
* **Role-Based Access Control (RBAC)**:
  - **Owner**: Full control over workspace (auto-assigned on workspace creation)
  - **Admin**: Can manage devices, assets, clients, members, and roles
  - **User**: View-only access to workspace data
  - **Super Admin**: System-wide access (configured via `SUPER_ADMIN_IDS` environment variable)
* **Role Management**: Admin/owner can toggle member roles (admin ↔ user). Super admin can manage all users across all workspaces
* **Multi-Device Session Management**: Track active sessions with device/IP info, remote logout per session
* **Workspace-based Access**: Multi-user support with workspace isolation
* **Auto-Workspace Cleanup**: When a user joins another workspace, their old (empty) workspace is automatically deleted with all related data

### ⚙️ Settings & Configuration
* **Device Management**: Add, edit, and manage multiple MikroTik devices
* **Profile Management**: Update display name, WhatsApp number, change password, upload avatar (with cropping)
* **Workspace Members**: View, kick, and manage member roles
* **Workspace Invitations**: Generate time-limited invite codes for others to join your workspace
* **Advanced Backup & Restore**:
  - **Workspace-aware Export**: Export workspace data + photo files to ZIP
  - **Granular Restore**: Restore to same or different workspace with ID remapping
  - **Factory Reset**: Wipe workspace-specific operational data with automatic backup download
  - Restricted to Super Admin / Workspace Owner
* **Super Admin Global Control**:
  - View and manage all users across all workspaces
  - Centralized WhatsApp group management for all workspaces
  - Factory reset any workspace
* **Active Sessions**: View all active login sessions, revoke individual sessions remotely
* **Danger Zone**: Factory reset, account deletion with safety checks

---

## 🛠️ Tech Stack

| Frontend                          | Backend                              |
| --------------------------------- | ------------------------------------ |
| **Next.js 15** (App Router)       | **Node.js 20+**                      |
| **React 19** & **TypeScript**     | **Express.js 5.x**                   |
| **Tailwind CSS 4** (PostCSS 8)    | **MySQL 8**                          |
| **Chart.js 4** (data visualization)| **node-routeros** (MikroTik API)     |
| **Leaflet 1.9** (interactive maps)| **@whiskeysockets/baileys** (WhatsApp) |
| **Framer Motion 12** (animations) | **JWT** (Authentication)             |
| **sonner** (Toast notifications)  | **node-cron 4** (Scheduled Tasks)     |
| **react-leaflet 5** (map components)| **WebSocket (ws) 8** (Real-time)      |
| **OSRM Routing** (road routing)   | **PDFKit** (PDF generation)           |
| **dnd-kit** (Drag & Drop)         | **bcryptjs** (Password hashing)      |
| **lucide-react** (icons)          | **pino** (Logger)                    |

---

## 🚀 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (v20 or later)
* [MySQL](https://www.mysql.com/) or MariaDB (v8.0 or later)
* RouterOS 7.xx version
* A dedicated WhatsApp number for the gateway
* PM2 (for production deployment)

### Development Setup

#### Backend Setup

1. **Navigate to the backend directory:**
```bash
cd backend
```

2. **Install dependencies:**
```bash
npm install
```

3. **Setup the database:**
```bash
mysql -u root -p < backend/database_setup.sql
```

4. **Configure environment variables:**
Create a `.env` file in the `backend` directory:
```env
# Database
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=jnet_monitoring

# JWT Secret (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET=your_super_secret_jwt_key_min_32_chars

# Server
PORT=9494
NODE_ENV=development

# CORS
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Super Admin (comma-separated User IDs, default: 1)
SUPER_ADMIN_IDS=1
```
        
5. **Run the backend server:**
```bash
npm run dev
```
The backend API will be running on `http://localhost:9494`.

#### Frontend Setup

1. **Navigate to the frontend directory:**
```bash
cd next
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
Create a `.env.local` file in the `next` directory:
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:9494
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:9494/ws
```

4. **Run the frontend development server:**
```bash
npm run dev
```
The application will be accessible at `http://localhost:3000`.

---

## 🚀 Production Deployment

### Prerequisites

*   **OS**: Linux Server (Ubuntu 22.04+ or Debian 11+ recommended)
*   **Node.js**: v20.x (LTS) or later
*   **Database**: MySQL v8.0 or MariaDB v10.6+
*   **Process Manager**: [PM2](https://pm2.keymetrics.io/) (`npm install -g pm2`)
*   **Web Server**: Nginx or Apache2 (as reverse proxy)

### Phase 1: Database Setup

```bash
mysql -u root -p -e "CREATE DATABASE jnet_monitoring CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p jnet_monitoring < backend/database_setup.sql
```

### Phase 2: Backend Deployment

```bash
cd backend
npm install --production
```

Create a `.env` file:
```env
DB_HOST=127.0.0.1
DB_USER=your_db_user
DB_PASSWORD=your_secure_password
DB_NAME=jnet_monitoring
JWT_SECRET=your_jwt_secret
PORT=9494
NODE_ENV=production
CORS_ORIGINS=https://yourdomain.com
SUPER_ADMIN_IDS=1
```

Setup directories and start:
```bash
mkdir -p public/uploads/avatars public/uploads/assets public/uploads/clients
chmod -R 755 public
pm2 start server.js --name jnet-monitoring-api
pm2 save
```

### Phase 3: Frontend Deployment

Create `.env.production` in the `next/` directory:
```env
NEXT_PUBLIC_API_BASE_URL=https://yourdomain.com/api
NEXT_PUBLIC_WS_BASE_URL=wss://yourdomain.com/ws
```

Build and start:
```bash
cd next
npm install
npm run build
pm2 start "npm start" --name jnet-monitoring-web
pm2 save
```

### Phase 4: Reverse Proxy Configuration

#### Nginx (Recommended)

```nginx
server {
    listen 443 ssl;
    server_name monitor.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/monitor.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/monitor.yourdomain.com/privkey.pem;

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:9494/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:9494/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Static Assets (Photos)
    location /public/ {
        proxy_pass http://localhost:9494/public/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

#### Apache2

```apache
<VirtualHost *:80>

    ServerName monitoring.j-net.my.id
    # Note: ServerName disesuaikan dengan domain yang Anda gunakan
    ProxyPreserveHost On

    # Backend API
    ProxyPass /api/ http://127.0.0.1:9494/api/
    ProxyPassReverse /api/ http://127.0.0.1:9494/api/

    # Static uploads
    ProxyPass /public/ http://127.0.0.1:9494/public/
    ProxyPassReverse /public/ http://127.0.0.1:9494/public/

    # WebSocket
    ProxyPass /ws ws://127.0.0.1:9494/ws
    ProxyPassReverse /ws ws://127.0.0.1:9494/ws

    # Frontend Next.js
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

</VirtualHost>
```

Required Apache2 modules:
```bash
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod proxy_wstunnel
sudo systemctl restart apache2
```

### Phase 5: Verification

```bash
pm2 list                        # Ensure both services are online
pm2 logs                        # Check for errors
netstat -tulpn | grep LISTEN    # Verify ports 3000, 9494, 80/443
```

---

## 📁 Project Structure

```
skydash-next-monitoring/
├── backend/
│   ├── src/
│   │   ├── bot/              # WhatsApp service, data logger, notification handler
│   │   ├── config/           # Database configuration
│   │   ├── controllers/      # Route controllers (19 controllers)
│   │   ├── middleware/       # Auth, upload middleware
│   │   ├── routes/           # API routes (19 route files)
│   │   ├── services/         # Business logic services
│   │   └── utils/            # Utility functions
│   ├── public/               # Static files
│   │   └── uploads/
│   │       ├── avatars/      # User profile photos
│   │       ├── assets/       # Network asset photos (ODP, ODC, OLT)
│   │       └── clients/      # Client profile photos
│   ├── database_setup.sql    # Complete database schema + migrations + seeder
│   ├── server.js             # Main server file
│   └── package.json
├── next/
│   ├── src/
│   │   ├── app/              # Next.js app router pages
│   │   │   ├── (auth)/       # Login, register, forgot-password
│   │   │   └── (main)/       # Dashboard, management, location, SLA, reports, settings
│   │   ├── components/        # React components
│   │   │   ├── dashboard/    # Dashboard widgets
│   │   │   ├── management/   # PPPoE, Hotspot, IP Pool management
│   │   │   ├── location/     # Map display and asset modals
│   │   │   ├── settings/     # Settings cards (14 components)
│   │   │   ├── providers/    # Auth, Mikrotik, Theme contexts
│   │   │   └── ui/           # Shared UI components
│   │   ├── lib/              # Utility libraries
│   │   └── utils/            # Helper functions (API fetch, formatters)
│   ├── .env.production       # Production environment variables
│   └── package.json
└── README.md
```

---

## 🗄️ Database Schema

The application uses MySQL with the following tables:

| Table | Description |
|-------|-------------|
| `workspaces` | Workspace/organization management with WhatsApp config |
| `users` | User accounts with role (admin/user), WhatsApp number |
| `mikrotik_devices` | MikroTik device configurations (host, port, credentials) |
| `network_assets` | Network infrastructure (MikroTik, OLT, ODC, ODP) with photos |
| `clients` | Client/PPPoE user locations, connections, and photos |
| `odp_user_connections` | Connections between clients and ODPs |
| `ip_pools` | IP pool configurations per PPPoE profile |
| `resource_logs` | Historical CPU and Memory usage (every 3 seconds) |
| `pppoe_usage_logs` | PPPoE user daily usage statistics |
| `downtime_events` | User downtime tracking with duration and notification status |
| `pppoe_user_status` | Real-time PPPoE user status with delta tracking |
| `user_sessions` | Active login sessions (token, user-agent, IP) |
| `dashboard_snapshot` | Cached dashboard data for instant loading |
| `workspace_invites` | Time-limited invite codes for workspace joining |
| `login_otps` | OTP codes for login authentication |
| `pending_registrations` | Pending user registrations (WhatsApp OTP flow) |
| `alarms` | Configurable alert thresholds (CPU, memory, offline) |

All workspace-scoped tables use `ON DELETE CASCADE` foreign keys for automatic cleanup.

See `backend/database_setup.sql` for complete schema definition.

---

## 🔌 API Endpoints

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/login` | Request login OTP via WhatsApp |
| POST | `/login/verify` | Verify OTP and login |
| POST | `/logout` | Logout and revoke session |
| POST | `/forgot-password` | Request password reset OTP |
| POST | `/reset-password` | Reset password with OTP |
| GET | `/me` | Get current user info |

### Registration (`/api/registration`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Register new user (WhatsApp OTP) |
| POST | `/verify-otp` | Verify registration OTP |

### User Profile (`/api/user`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/details` | Update display name, WhatsApp number |
| PUT | `/change-password` | Change password |
| POST | `/avatar` | Upload avatar (multipart) |
| DELETE | `/` | Delete user account |

### Sessions (`/api/sessions`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List active sessions |
| DELETE | `/:id` | Revoke specific session |

### Devices (`/api/devices`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all devices |
| POST | `/` | Add new device |
| PUT | `/:id` | Update device |
| DELETE | `/:id` | Delete device |

### PPPoE (`/api/pppoe`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/secrets` | List PPPoE secrets |
| POST | `/secrets` | Create PPPoE secret |
| PUT | `/secrets/:id` | Update PPPoE secret |
| DELETE | `/secrets/:id` | Delete PPPoE secret |
| POST | `/active/*/kick` | Kick active user |
| GET | `/secrets/:name/usage` | Get usage history |
| GET | `/secrets/:name/sla` | Get SLA details & downtime events |
| GET | `/profiles` | List PPPoE profiles |

### Assets & Clients (`/api/assets`, `/api/clients`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/assets` | List or create network assets |
| PUT/DELETE | `/assets/:id` | Update or delete asset |
| GET/POST | `/clients` | List or create clients |
| PUT/DELETE | `/clients/:id` | Update or delete client |

### IP Pools (`/api/ip-pools`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List IP pools |
| POST | `/` | Create or update IP pool |
| DELETE | `/:id` | Delete IP pool |
| POST | `/sync` | Sync IP pools from MikroTik |

### Workspace (`/api/workspaces`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/me` | Get workspace info |
| POST | `/set-active-device` | Set active device [Admin] |
| PUT | `/whatsapp-group-id` | Update WhatsApp Group ID [Admin] |
| GET | `/interfaces-by-device` | Get interfaces for device |
| GET | `/members` | List workspace members |
| DELETE | `/members/:userId` | Remove member [Admin] |
| PATCH | `/members/:userId/role` | Toggle member role [Admin] |
| GET | `/all` | List all workspaces [Super Admin] |
| GET | `/all-users` | List all users across workspaces [Super Admin] |
| PUT | `/:workspaceId/whatsapp-group-id` | Update Group ID for any workspace [Super Admin] |

### Workspace Invitations (`/api/clone`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/generate-code` | Generate invite code [Admin] |
| POST | `/use-code` | Join workspace via invite code |

### Backup & Maintenance (`/api/backup`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/export` | Export workspace backup (ZIP + photos) |
| POST | `/restore` | Restore from backup ZIP |
| POST | `/factory-reset` | Factory reset workspace (with auto-backup) |

### WhatsApp Bot (`/api/bot`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Get bot connection status |
| GET | `/qr` | Get QR code for pairing |
| POST | `/test-message` | Send test message to group |
| GET | `/groups` | List available WhatsApp groups |
| POST | `/request-reset` | Request WhatsApp session reset |
| POST | `/reset-session` | Reset session with OTP |

### Reports & SLA
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/monthly` | Generate monthly PDF report |
| GET | `/api/sla/...` | SLA and downtime data |

### Import/Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/import/kml` | Import KML file |
| GET | `/api/import/kml` | Export KML file |

### WebSocket
* `ws://your-domain.com/ws` — Real-time updates (query: `deviceId`, `token`)

---

## 📊 Background Jobs

| Job | Interval | Description |
|-----|----------|-------------|
| Data Logging | 3 seconds | Log PPPoE usage from MikroTik queue |
| SLA Monitor | 3 seconds | Detect connections/disconnections, track downtime |
| Dashboard Snapshot | 3 seconds | Cache dashboard data, log CPU/Memory to `resource_logs` |
| Downtime Notifications | 30 seconds | Send WhatsApp/WebSocket alerts for 2+ min downtime |

---

## 📝 Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Database host | `localhost` |
| `DB_USER` | Database username | — |
| `DB_PASSWORD` | Database password | — |
| `DB_NAME` | Database name | `jnet_monitoring` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | — |
| `PORT` | Backend server port | `9494` |
| `NODE_ENV` | Environment (`development`/`production`) | `development` |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | — |
| `SUPER_ADMIN_IDS` | Comma-separated Super Admin User IDs | `1` |
| `LOG_LEVEL` | Log level (debug/info/warn/error) | `debug` |

### Frontend (`next/.env.local` / `.env.production`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | Backend API base URL |
| `NEXT_PUBLIC_WS_BASE_URL` | WebSocket base URL |

---

## 🚨 Troubleshooting

| Problem | Solution |
|---------|----------|
| **WebSocket Connection Failed** | Check reverse proxy config, ensure `proxy_wstunnel` is enabled, verify `NEXT_PUBLIC_WS_BASE_URL` |
| **OTP Always Expired** | Set database timezone: `SET GLOBAL time_zone = '+07:00';` |
| **Public Folder Not Accessible** | `mkdir -p backend/public/uploads/avatars` + `chmod -R 755 backend/public` |
| **CORS Error** | Ensure `CORS_ORIGINS` includes your domain, restart backend |
| **Port Already in Use** | `lsof -ti:9494 \| xargs kill -9` or check `pm2 list` |
| **Favicon Not Loading** | Rebuild frontend: `npm run build`, clear browser cache |

---

## 🤝 Contributing

1. **Fork** the Project
2. Create your Feature Branch (`git checkout -b feature/NewFeature`)
3. Commit your Changes (`git commit -m 'Add some New Feature'`)
4. Push to the Branch (`git push origin feature/NewFeature`)
5. Open a **Pull Request**

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

* [MikroTik](https://mikrotik.com/) for RouterOS API
* [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp integration
* [Leaflet](https://leafletjs.com/) for interactive maps
* [OSRM](http://project-osrm.org/) for routing services

---

**Made with ❤️ for network administrators**
