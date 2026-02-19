# JNET MONITORING TOOLS
<h3 align="center">A modern, web-based dashboard for monitoring and managing MikroTik routers.</h3>

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

JNET Monitoring is a full-stack application designed to provide an intuitive and powerful interface for managing MikroTik devices. It combines a real-time monitoring dashboard with comprehensive management tools for PPPoE, Hotspot, and network assets, enhanced with an interactive WhatsApp bot for on-the-go management.

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

### 👥 User Management
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
  - Optimized batch processing for fast synchronization

### 🗺️ Network Asset Mapping
* **Interactive Map**: Visualize your network infrastructure (MikroTik, OLT, ODC, ODP) on an interactive Leaflet map
* **Client Mapping**: Display clients (PPPoE users) on the map with connection lines to ODPs
* **Route-based Connections**: Connection lines follow roads using OSRM routing API
* **KML Import/Export**: Import network assets from KML files and export for backup
* **Asset Management**: 
  - Manage network assets (MikroTik, OLT, ODC, ODP) with coordinates
  - Filter assets by owner
  - View detailed asset information with connected clients/users
  - **Asset Photos**: Upload and view physical photos (ODP, ODC, OLT) for field identification
  - **FullScreen Preview**: Click thumbnails to view high-resolution, uncropped asset photos
  - **Automated Cleanup**: System automatically deletes orphaned photo files when assets are updated or removed
* **Client Management**:
  - Link PPPoE secrets to clients with location coordinates
  - Connect clients to ODP assets
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
* **Real-time Map Status**: 
  - **Dynamic Markers**: Client and ODP markers update status instantly via WebSocket (no refresh needed)
  - **Traffic Flow Animation**: Animated connection lines to visualize active traffic from parent to child
  - **Auto-ODP State**: ODP markers turn red automatically if all connected clients are offline
* **Notifications**: 
  - WhatsApp notifications for downtime events (after 2 minutes)
  - Reconnect notifications (only if preceding downtime was >= 2 minutes)
  - Toast notifications in web dashboard for downtime, reconnect, and device connection status (WebSocket)
  - WebSocket real-time updates for all connected clients

### 📄 Report Generation
* **Monthly PDF Reports**: Generate comprehensive monthly reports in PDF format
* **Simplified Report Generation**:
  - Select year and month
  - Select one or more MikroTik devices
  - No need to select interfaces - automatically includes all device statistics
* **Report Sections**:
  - SLA & Downtime statistics
  - Device Statistics per MikroTik:
    - Average CPU Load percentage
    - Average Memory Usage
    - Total log entries
  - Client Statistics (PPPoE secret):
    - Total usage (upload + download)
    - Total downtime duration
    - Downtime events count
    - All clients automatically included for each selected device
* **Beautiful PDF Formatting**: 
  - Professional table layouts with repeating headers
  - Alternating row colors
  - Consistent borders and pagination
  - Centered tables with proper margins
  - Info boxes for device statistics

### 🤖 Interactive WhatsApp Bot
* **Commands Available**:
  - `.ping` - Check bot connection to dashboard
  - `.help` - Show available commands
  - `.log <topic?>` - View last 10 logs from MikroTik
  - `.cek <nama_user_pppoe>` - Check ODP location where user is connected
  - `.odp total` - View total and list of all ODPs
  - `.odp <nama_odp>` - View ODP details & connected users
  - `.disable <pppoe|hotspot> <nama>` - Disable user
  - `.enable <pppoe|hotspot> <nama>` - Enable user
  - `.kick <pppoe|hotspot> <nama>` - Disconnect active user
  - `.getgroupid` - Get WhatsApp Group ID for workspace configuration
* **Notifications**:
  - Critical alerts (high CPU, device offline)
  - Automated daily performance reports
  - Downtime and reconnect notifications
* **Group Management**: Configure WhatsApp Group ID via dashboard settings

### 🔐 Security & Authentication
* **Two-Factor Authentication**: OTP sent via WhatsApp for secure login
* **JWT Authentication**: Secure token-based authentication
* **Super Admin Role**: Restricted access for sensitive bot operations (toggle, reset, global management)
* **Multi-User Super Admin**: Configurable list of Super Admin IDs via environment variables
* **Session Management**: Track user sessions with device and location information
* **Workspace-based Access**: Multi-user support with workspace isolation

### ⚙️ Settings & Configuration
* **Device Management**: Add, edit, and manage multiple MikroTik devices
* **Workspace Settings**: Configure active device, main interface, and WhatsApp bot
* **Advanced Backup & Factory Reset**:
  - **Full Backup**: Export entire database and avatars to a password-less ZIP
  - **Restore**: Easy restoration from ZIP file
  - **Factory Reset**: Wipe workspace-specific operational data with automatic backup download
* **Super Admin Global Control**:
  - Centralized WhatsApp group management for all workspaces
  - Dynamic dropdown for choosing active WhatsApp groups
* **WhatsApp Group ID**: Update group ID via dashboard (no manual database input needed)
* **User Profile**: Manage profile picture and display name

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

* [Node.js](https://nodejs.org/) (v18 or later)
* [MySQL](https://www.mysql.com/) or MariaDB (v8.0 or later)
* RouterOS 7.xx version
* A dedicated WhatsApp number for the bot
* PM2 (for production deployment)
* Apache2 (for reverse proxy in production)

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
* Create a new MySQL database (e.g., `jnet_monitoring`)
* Execute the SQL file `backend/database_setup.sql` to create all necessary tables, migrations, and set timezone
  ```bash
  mysql -u root -p < backend/database_setup.sql
  ```
* (Optional) Uncomment seeder section in `database_setup.sql` for default admin user
* **Note**: For initial deployment, use `database_setup.sql` which includes all migrations. For existing databases, use individual migration files.

4. **Configure environment variables:**
* Create a `.env` file in the `backend` directory:
```env
# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=jnet_monitoring

# JWT Secret (generate a secure random string)
JWT_SECRET=your_super_secret_jwt_key_min_32_chars

# Server Configuration
 PORT=9494
NODE_ENV=development

# CORS Origins (comma-separated, no spaces after comma)
CORS_ORIGINS=http://localhost:3000,http://172.27.0.10:3000
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
* Create a `.env.local` file in the `next` directory:
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

A collection of steps to move JNET Monitoring from development to a live production environment.

### Prerequisites for Production

*   **OS**: Linux Server (Ubuntu 22.04+ or Debian 11+ recommended)
*   **Node.js**: v20.x (LTS) or later
*   **Database**: MySQL v8.0 or MariaDB v10.6+
*   **Process Manager**: [PM2](https://pm2.keymetrics.io/) installed globally (`npm install -g pm2`)
*   **Web Server**: Nginx or Apache2 (as reverse proxy)
*   **Network**: Direct access to router management ports and WhatsApp servers

### Phase 1: Database Setup

1.  **Initialize Database**:
    ```bash
    mysql -u root -p -e "CREATE DATABASE jnet_monitoring CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    mysql -u root -p jnet_monitoring < backend/database_setup.sql
    ```
    *Note: `database_setup.sql` contains the complete schema, initial migrations, and default configurations.*

2.  **Configure System Timezone**:
    Ensure your database server uses the same timezone as your network (e.g., WIB/GMT+7):
    ```sql
    SET GLOBAL time_zone = '+07:00';
    ```

### Step 2: Backend Setup

1. **Navigate to backend directory:**
```bash
cd /var/www/JNET_Monitoring/backend
```

2. **Install dependencies:**
```bash
npm install
```

3. **Create `.env` file:**
```bash
nano .env
```

**Isi dengan:**
```env
# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=jnet_monitoring

# JWT Secret (generate secure random string)
JWT_SECRET=your_super_secret_jwt_key_min_32_chars

# Server Configuration
PORT=9494
NODE_ENV=production

# CORS Origins - GANTI dengan domain production Anda
CORS_ORIGINS=https://yourwebsite.com,http://yourwebsite.com

# Super Admin IDs (comma-separated list of User IDs)
### Phase 2: Backend Deployment

1.  **Install Dependencies**:
    ```bash
    cd backend
    npm install --production
    ```

2.  **Production Environment**:
    Create a `.env` file in the `backend/` directory:
    ```env
    DB_HOST=127.0.0.1
    DB_USER=your_db_user
    DB_PASSWORD=your_secure_password
    DB_NAME=jnet_monitoring
    JWT_SECRET=your_jwt_secret
    PORT=9494
    NODE_ENV=production
    CORS_ORIGINS=https://yourdomain.com
    SUPER_ADMIN_IDS=1,2
    ```

3.  **Directory Permissions**:
    ```bash
    mkdir -p public/uploads/avatars public/uploads/assets public/uploads/clients
    chmod -R 755 public
    ```

4.  **Start with PM2**:
    ```bash
    pm2 start server.js --name jnet-monitoring-api
    pm2 save
    ```

### Phase 3: Frontend Deployment (Next.js 15)

1.  **Configure Build Variables**:
    Create a `.env.production` file in the `next/` directory:
    ```env
    NEXT_PUBLIC_API_BASE_URL=https://yourdomain.com/api
    NEXT_PUBLIC_WS_BASE_URL=wss://yourdomain.com/ws
    ```

2.  **Build Optimized Application**:
    ```bash
    cd next
    npm install
    npm run build
    ```

3.  **Start with PM2**:
    ```bash
    pm2 start "npm start" --name jnet-monitoring-web
    pm2 save
    ```

4.  **Verify Application**:
    ```bash
    pm2 status
    curl http://localhost:3000
    ```

### Step 4: Apache2 Reverse Proxy Setup

1. **Enable required Apache2 modules:**
```bash
a2enmod proxy
a2enmod proxy_http
a2enmod proxy_wstunnel
a2enmod rewrite
a2enmod headers
systemctl restart apache2
```

2. **Create Apache2 virtual host:**
```bash
nano /etc/apache2/sites-available/jnet-monitoring.conf
```
### Phase 4: Reverse Proxy Configuration

#### Nginx (Recommended)

```nginx
server {
    listen 443 ssl;
    server_name monitor.yourdomain.com;

    # SSL (Managed by Certbot)
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

    # WebSocket (MikroTik/Dashboard)
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
<VirtualHost *:443>
    ServerName monitor.yourdomain.com
    
    # SSL config... (Certbot)

    # API & Public Files
    ProxyPass /api http://localhost:9494
    ProxyPass /public http://localhost:9494/public

    # WebSocket
    ProxyPass /ws ws://localhost:9494/ws
    ProxyPassReverse /ws ws://localhost:9494/ws

    # Frontend
    ProxyPass / http://localhost:3000/
</VirtualHost>
```

### Phase 5: Cloudflare Tunnel (Optional)

If using Cloudflare Tunnel for secure external access:
1.  **Expose Site**: Point your tunnel configuration to `http://localhost:80` (if using proxy) or `http://localhost:3000`.
2.  **WebSocket Support**: Ensure "WebSockets" is enabled in Cloudflare dashboard under Network settings.

### Phase 6: System Verification

1.  **Check Processes**: `pm2 list` (Ensure `jnet-monitoring-api` and `jnet-monitoring-web` are online).
2.  **Check Logs**: `pm2 logs` for real-time debugging.
3.  **Check Ports**: `netstat -tulpn | grep LISTEN` (Verify 3000, 9494, and 80/443).

---

## 📁 Project Structure

```
skydash-next-monitoring/
├── backend/
│   ├── src/
│   │   ├── bot/              # Bot services (data logger, command handler, report generator)
│   │   ├── config/           # Database configuration
│   │   ├── controllers/      # Route controllers
│   │   ├── middleware/       # Authentication middleware
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic services
│   │   └── utils/            # Utility functions
│   ├── public/               # Static files (avatars, uploads)
│   │   └── uploads/
│   │       ├── avatars/      # Foto User (Profile)
│   │       ├── assets/       # Foto Network Assets
│   │       └── clients/      # Foto Profil Client
│   ├── database_schema.sql   # Database schema
│   ├── database_seeder.sql    # Sample data seeder
│   ├── migration_*.sql        # Database migrations
│   ├── server.js             # Main server file
│   └── package.json
├── next/
│   ├── src/
│   │   ├── app/              # Next.js app router pages
│   │   │   ├── (auth)/       # Authentication pages
│   │   │   └── (main)/       # Main application pages
│   │   │       ├── dashboard/
│   │   │       ├── management/
│   │   │       ├── location/
│   │   │       ├── hotspot/
│   │   │       ├── sla/
│   │   │       ├── report/
│   │   │       └── settings/
│   │   ├── components/        # React components
│   │   │   ├── dashboard/    # Dashboard components
│   │   │   ├── management/   # Management components
│   │   │   ├── location/     # Map and location components
│   │   │   └── providers/   # Context providers
│   │   ├── lib/              # Utility libraries
│   │   └── utils/            # Helper functions
│   ├── .env.production       # Production environment variables
│   └── package.json
└── README.md
```

---

## 🗄️ Database Schema

The application uses MySQL with the following main tables:

* **workspaces** - Workspace/organization management
* **users** - User accounts with WhatsApp integration
* **mikrotik_devices** - MikroTik device configurations
* **network_assets** - Network infrastructure (MikroTik, OLT, ODC, ODP)
* **clients** - Client/PPPoE user locations and connections
* **odp_user_connections** - Connections between clients and ODPs
* **ip_pools** - IP pool configurations for PPPoE profiles
* **resource_logs** - Historical CPU and Memory usage logs (logged every 3 seconds)
* **pppoe_usage_logs** - PPPoE user daily usage statistics (upload, download, total bytes)
* **downtime_events** - User downtime tracking with duration and timestamps
* **pppoe_user_status** - Real-time PPPoE user status
* **user_sessions** - Active user sessions
* **dashboard_snapshot** - Cached dashboard data for instant loading
* **login_otps** - OTP codes for authentication
* **pending_registrations** - Pending user registrations

See `backend/database_schema.sql` for complete schema definition.

---

## 🔌 API Endpoints

### Authentication
* `POST /api/auth/login` - Request login OTP
* `POST /api/auth/verify-otp` - Verify OTP and login
* `POST /api/auth/logout` - User logout
* `GET /api/auth/me` - Get current user info

### Devices
* `GET /api/devices` - List all devices
* `POST /api/devices` - Add new device
* `PUT /api/devices/:id` - Update device
* `DELETE /api/devices/:id` - Delete device

### PPPoE
* `GET /api/pppoe/secrets` - List PPPoE secrets
* `POST /api/pppoe/secrets` - Create PPPoE secret
* `PUT /api/pppoe/secrets/:id` - Update PPPoE secret
* `DELETE /api/pppoe/secrets/:id` - Delete PPPoE secret
* `POST /api/active/*/kick` - Kick active user
* `GET /api/pppoe/secrets/:name/usage` - Get usage history (daily, weekly, monthly)
* `GET /api/pppoe/secrets/:name/sla` - Get SLA details and downtime events

### Assets & Clients
* `GET /api/assets` - List network assets
* `POST /api/assets` - Create asset
* `PUT /api/assets/:id` - Update asset
* `DELETE /api/assets/:id` - Delete asset
* `GET /api/clients` - List clients
* `POST /api/clients` - Create client
* `PUT /api/clients/:id` - Update client
* `DELETE /api/clients/:id` - Delete client

### IP Pools
* `GET /api/ip-pools` - List IP pools
* `POST /api/ip-pools` - Create or update IP pool
* `DELETE /api/ip-pools/:id` - Delete IP pool
* `POST /api/ip-pools/sync?deviceId=X` - Sync IP pools from MikroTik device

### Backup & Maintenance
* `GET /api/backup/export` - Export full system backup (ZIP)
* `POST /api/backup/restore` - Restore system from backup ZIP
* `POST /api/backup/factory-reset` - Perform workspace factory reset (with auto-backup)

### Import/Export
* `POST /api/import/kml` - Import KML file
* `GET /api/import/kml` - Export KML file

### Reports
* `GET /api/reports/monthly` - Generate monthly PDF report
  * Query parameters: `year`, `month`, `devices` (JSON array of device IDs)
  * Automatically includes device statistics (CPU & Memory) and all client statistics for selected devices

### Workspace
* `GET /api/workspaces/me` - Get workspace info
* `PUT /api/workspaces/set-active-device` - Set active device
* `PUT /api/workspaces/set-main-interface` - Set main interface
* `PUT /api/workspaces/whatsapp-group-id` - Update WhatsApp Group ID
* `GET /api/workspaces/interfaces-by-device` - Get interfaces for device
* `GET /api/workspaces/all` - [Super Admin] List all workspaces in system
* `PUT /api/workspaces/:workspaceId/whatsapp-group-id` - [Super Admin] Update Group ID for any workspace

### WebSocket
* `ws://your-domain.com/ws` - WebSocket connection for real-time updates
  * Query parameters: `deviceId`, `token` (JWT)

---

## 🤖 WhatsApp Bot Setup

1. **Enable WhatsApp Bot:**
   - Go to Settings page in the dashboard
   - Enable "Bot WhatsApp Interaktif" (Requires Super Admin privileges)
   - The bot will generate a QR code for initial pairing

2. **Configure Group ID:**
   - In a WhatsApp group, send `.getgroupid`
   - Copy the Group JID from the response (format: `120363424303016733@g.us`)
   - Go to Settings → Bot WhatsApp Interaktif
   - Select the desired group from the **Dropdown Menu** and save
   - All notifications for that workspace will be sent to the selected group

3. **Available Commands:**
   - See [Interactive WhatsApp Bot](#-interactive-whatsapp-bot) section above

---

## 🔔 Notification System

### Downtime Notifications
* **Trigger**: User disconnects for 2+ minutes
* **Channels**: WhatsApp + WebSocket (toast notification)
* **Content**: User name, downtime duration (formatted as "x hari x jam x menit x detik")

### Reconnect Notifications
* **Trigger**: User reconnects after a downtime of 2+ minutes
* **Channels**: WhatsApp + WebSocket (toast notification)
* **Content**: User name, previous downtime duration

### System Alerts
* High CPU usage
* Device offline
* Daily performance reports

### Gateway Connection Alerts
* **Trigger**: Mikrotik device connects or disconnects from the dashboard
* **Channel**: Web Dashboard (Real-time Toasts)
* **Content**: Device name and current connection status (Disconnected / Reconnected)

---

## 🗺️ Map Features

### Interactive Map
* **Technology**: Leaflet with OpenStreetMap
* **Features**:
  - Display network assets (MikroTik, OLT, ODC, ODP) with custom icons
  - Show clients with color-coded markers (green=active, red=inactive)
  - Connection lines between clients and ODPs
  - Route-based connections using OSRM API
  - Filter by asset owner (clients follow ODP owner filter)
  - Clickable coordinates (opens Google Maps)

### KML Support
* Import network assets from KML files
* Export all assets and clients to KML for backup
* Support for multiple asset owners

---

## 📊 Report Features

### Monthly PDF Reports
* **Selection Options**:
  - Choose year and month
  - Select one or more MikroTik devices
  - No interface selection needed - automatically includes all device statistics

* **Report Content**:
  - SLA & Downtime statistics
  - Device Statistics per MikroTik:
    - Average CPU Load (from `resource_logs`)
    - Average Memory Usage (from `resource_logs`)
    - Total log entries count
  - Client Statistics (automatically included for all selected devices):
    - All PPPoE users with their usage data
    - Total usage (bytes)
    - Total downtime duration
    - Downtime events count
    - Total users count per device

* **PDF Features**:
  - Professional formatting with info boxes
  - Repeating table headers on each page
  - Alternating row colors
  - Consistent borders and margins
  - Proper pagination with footers
  - Device-specific sections with clear organization

---

## 🔧 Development

### Running in Development Mode

**Backend:**
```bash
cd backend
npm run dev  # Uses nodemon for auto-reload
```

**Frontend:**
```bash
cd next
npm run dev  # Next.js development server with hot reload
```

### Database Setup

**For Initial Deployment:**
* Use `backend/database_setup.sql` - This file includes:
  - Complete database schema
  - All migrations (clients table, notification_sent column, whatsapp_group_id column, resource_logs table)
  - Timezone setup
  - Indexes for performance
  - Optional seeder (commented out)

**For Existing Databases:**
* Apply individual migration files in order (if needed):
  * `migration_add_clients_table.sql`
  * `migration_add_notification_sent_to_downtime_events.sql`
  * `migration_add_whatsapp_group.sql`

### Background Jobs (Cron Jobs)

The application runs several background jobs automatically:

* **Data Logging** (every 3 seconds):
  - Logs PPPoE usage from MikroTik queue simple
  - Stores daily usage in `pppoe_usage_logs` table

* **SLA & Notifications** (every 3 seconds):
  - Monitors user connections/disconnections
  - Detects downtime events
  - Sends notifications (WhatsApp + WebSocket)

* **Dashboard Snapshot** (every 3 seconds):
  - Updates cached dashboard data
  - Logs resource data (CPU & Memory) to `resource_logs`
  - Stores snapshot in `dashboard_snapshot` for instant loading

* **Downtime Notifications** (every 30 seconds):
  - Checks for ongoing downtime events
  - Sends notifications for events >= 2 minutes

* **Daily Reports** (every day at 00:00):
  - Generates and sends daily performance reports via WhatsApp

---

## 📝 Environment Variables

### Backend (.env)

```env
# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=jnet_monitoring

# JWT Secret (generate secure random string, min 32 chars)
JWT_SECRET=your_super_secret_jwt_key

# Server Configuration
PORT=9494
NODE_ENV=production

# CORS Origins (comma-separated, no spaces after comma)
# Production: use your domain
CORS_ORIGINS=https://yourwebsite.com,http://yourwebsite.com
# Development: use localhost
# CORS_ORIGINS=http://localhost:3000,http://172.27.0.10:3000
```

### Frontend (.env.production)

```env
# API Base URL - use your production domain
NEXT_PUBLIC_API_BASE_URL=https://yourwebsite.com

# WebSocket Base URL - use your production domain with /ws path
NEXT_PUBLIC_WS_BASE_URL=wss://yourwebsite.com/ws
```

### Frontend (.env.local) - Development

```env
# API Base URL - use localhost for development
NEXT_PUBLIC_API_BASE_URL=http://localhost:9494

# WebSocket Base URL - use localhost with /ws path
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:9494/ws
```

---

## 🚨 Troubleshooting

### WebSocket Connection Failed
* **Check Apache2 config**: Ensure `ProxyPass /ws ws://localhost:9494/ws` is configured
* **Check modul**: Ensure `proxy_wstunnel` is enabled: `a2enmod proxy_wstunnel`
* **Check backend**: Verify backend WebSocket server is running: `pm2 logs jnet-backend`
* **Check frontend**: Verify `NEXT_PUBLIC_WS_BASE_URL` is set correctly in `.env.production`

### OTP Always Expired
* **Check timezone**: Ensure database timezone matches server timezone
* **Set database timezone**: `SET GLOBAL time_zone = '+07:00';` (adjust to your timezone)
* **Set MySQL config**: Add `default-time-zone = '+07:00'` in MySQL config file

### Public Folder Not Accessible
* **Create folder**: `mkdir -p backend/public/uploads/avatars`
* **Set permissions**: `chmod -R 755 backend/public`
* **Check Apache2**: Ensure `ProxyPass /public http://localhost:9494/public` is configured
* **Check backend**: Verify `app.use('/public', express.static('public'))` in server.js

### Favicon Not Loading
* **Check favicon location**: Ensure `favicon.ico` exists in `next/src/app/favicon.ico`
* **Rebuild frontend**: Run `npm run build` in `next/` directory to regenerate static files
* **Check Apache2 config**: Ensure `ProxyPass /favicon.ico` is configured before general proxy (see Step 4)
* **Check Next.js build**: Verify favicon is accessible after build: `curl http://localhost:3000/favicon.ico`
* **Clear browser cache**: Hard refresh (Ctrl+Shift+R) or clear cache
* **Check file permissions**: `chmod 644 next/src/app/favicon.ico` and rebuild
* **Alternative**: Copy favicon to `next/public/favicon.ico` as fallback

### CORS Error
* **Check backend .env**: Ensure `CORS_ORIGINS` includes your production domain
* **Check frontend .env**: Ensure `NEXT_PUBLIC_API_BASE_URL` uses your production domain
* **Restart backend**: `pm2 restart jnet-backend` after changing `.env`

### Port Already in Use
* **Kill process**: `sudo lsof -ti:9494 | xargs sudo kill -9` (for backend)
* **Kill process**: `sudo lsof -ti:3000 | xargs sudo kill -9` (for frontend)
* **Check PM2**: `pm2 list` to see running processes

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

## 📞 Support

For issues, questions, or contributions, please open an issue on the repository.

---

**Made with ❤️ for network administrators**
