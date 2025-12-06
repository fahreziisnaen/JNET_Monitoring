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

### 🗺️ Network Asset Mapping
* **Interactive Map**: Visualize your network infrastructure (MikroTik, OLT, ODC, ODP) on an interactive Leaflet map
* **Client Mapping**: Display clients (PPPoE users) on the map with connection lines to ODPs
* **Route-based Connections**: Connection lines follow roads using OSRM routing API
* **KML Import/Export**: Import network assets from KML files and export for backup
* **Asset Management**: 
  - Manage network assets (MikroTik, OLT, ODC, ODP) with coordinates
  - Filter assets by owner
  - View detailed asset information with connected clients/users
* **Client Management**:
  - Link PPPoE secrets to clients with location coordinates
  - Connect clients to ODP assets
  - View client details with clickable remote IP addresses and Google Maps links

### 📈 SLA & Downtime Tracking
* **SLA Monitoring**: Track user uptime and generate Service Level Agreement reports
* **Downtime Events**: 
  - Automatic detection of user disconnections
  - Track downtime duration with detailed timestamps
  - Format downtime duration as "x hari x jam x menit x detik"
* **Notifications**: 
  - WhatsApp notifications for downtime events (after 2 minutes)
  - Reconnect notifications (only if preceding downtime was >= 2 minutes)
  - Toast notifications in web dashboard
  - WebSocket real-time updates

### 📄 Report Generation
* **Monthly PDF Reports**: Generate comprehensive monthly reports in PDF format
* **Customizable Reports**:
  - Select specific MikroTik devices
  - Choose interfaces to include per device
  - Option to include client statistics per device
* **Report Sections**:
  - SLA & Downtime statistics
  - Bandwidth interface per MikroTik device
  - Client statistics (PPPoE secret: total usage, total downtime, downtime events)
  - Daily traffic summary
  - Total users per device
* **Beautiful PDF Formatting**: 
  - Professional table layouts with repeating headers
  - Alternating row colors
  - Consistent borders and pagination
  - Centered tables with proper margins

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
* **Session Management**: Track user sessions with device and location information
* **Workspace-based Access**: Multi-user support with workspace isolation

### ⚙️ Settings & Configuration
* **Device Management**: Add, edit, and manage multiple MikroTik devices
* **Workspace Settings**: Configure active device, main interface, and WhatsApp bot
* **WhatsApp Group ID**: Update group ID via dashboard (no manual database input needed)
* **User Profile**: Manage profile picture and display name

---

## 🛠️ Tech Stack

| Frontend                          | Backend                              |
| --------------------------------- | ------------------------------------ |
| **Next.js 15** (App Router)       | **Node.js**                          |
| **React 19** & **TypeScript**     | **Express.js 5**                     |
| **Tailwind CSS**                  | **MySQL 8**                          |
| **Chart.js** (data visualization) | **node-routeros** (MikroTik API)     |
| **Leaflet** (interactive maps)    | **@whiskeysockets/baileys** (WhatsApp) |
| **Framer Motion** (animations)    | **JWT** (Authentication)             |
| **shadcn/ui** (components)         | **node-cron** (Scheduled Tasks)      |
| **react-leaflet** (map components)| **WebSocket (ws)** (Real-time)       |
| **OSRM Routing** (road routing)   | **PDFKit** (PDF generation)           |
| **xml2js** (KML parsing)          | **bcryptjs** (Password hashing)      |

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

### Prerequisites for Production

* Linux server (Debian/Ubuntu recommended)
* Node.js v18+ installed
* MySQL/MariaDB installed and running
* PM2 installed globally (`npm install -g pm2`)
* Apache2 installed and configured
* Cloudflare Tunnel (optional, for external access)

### Step 1: Database Setup

1. **Create database and import complete setup:**
```bash
mysql -u root -p < /var/www/JNET_Monitoring/backend/database_setup.sql
```

**Atau secara manual:**
```bash
mysql -u root -p
```

```sql
SOURCE /var/www/JNET_Monitoring/backend/database_setup.sql;
```

**Note**: File `database_setup.sql` sudah termasuk:
- Database creation
- All tables (schema + migrations)
- Timezone setup
- Indexes
- Optional seeder (commented out)

2. **Set timezone permanen (opsional, untuk memastikan):**
Edit `/etc/mysql/mariadb.conf.d/50-server.cnf` (atau `/etc/mysql/my.cnf`):
```ini
[mysqld]
default-time-zone = '+07:00'
```

Restart MySQL:
```bash
systemctl restart mariadb
```

3. **Verify database setup:**
```sql
-- Check timezone
SELECT NOW(), @@global.time_zone, @@session.time_zone;

-- Check tables
SHOW TABLES;

-- Check if clients table exists
DESCRIBE clients;

-- Check if notification_sent column exists
DESCRIBE downtime_events;

-- Check if whatsapp_group_id column exists
DESCRIBE workspaces;
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
```

4. **Create public folder structure:**
```bash
mkdir -p public/uploads/avatars
chmod -R 755 public
chmod -R 644 public/uploads/avatars/*.jpg 2>/dev/null || true
chmod -R 644 public/uploads/avatars/*.png 2>/dev/null || true

# Upload default.jpg ke public/uploads/avatars/ jika belum ada
# Atau download placeholder:
cd public/uploads/avatars
wget https://via.placeholder.com/200x200.jpg -O default.jpg
```

5. **Start backend with PM2:**
```bash
pm2 start server.js --name "jnet-backend"
pm2 save
pm2 startup
```

6. **Verify backend is running:**
```bash
pm2 status
pm2 logs jnet-backend --lines 20
curl http://localhost:9494/api/auth/login
```

### Step 3: Frontend Setup

1. **Navigate to frontend directory:**
```bash
cd /var/www/JNET_Monitoring/next
```

2. **Install dependencies:**
```bash
npm install
```

3. **Create `.env.production` file:**
```bash
nano .env.production
```

**Isi dengan:**
```env
# API Base URL - GANTI dengan domain production Anda
NEXT_PUBLIC_API_BASE_URL=https://yourwebsite.com

# WebSocket Base URL - GANTI dengan domain production Anda
NEXT_PUBLIC_WS_BASE_URL=wss://yourwebsite.com/ws
```

4. **Build frontend:**
```bash
npm run build
```

5. **Start frontend with PM2:**
```bash
pm2 start npm --name "jnet-monitoring" -- start
pm2 save
```

6. **Verify frontend is running:**
```bash
pm2 status
pm2 logs jnet-monitoring --lines 20
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

**Isi dengan:**
```apache
<VirtualHost *:80>
    ServerName yourwebsite.com
    ServerAlias localhost 127.0.0.1
    
    ProxyPreserveHost On
    ProxyRequests Off
    
    # Proxy WebSocket di path /ws ke backend
    ProxyPass /ws ws://localhost:9494/ws
    ProxyPassReverse /ws ws://localhost:9494/ws
    
    # Proxy /api/* ke backend (HTTP)
    ProxyPass /api http://localhost:9494/api
    ProxyPassReverse /api http://localhost:9494/api
    
    # Proxy /public/* ke backend (HTTP)
    ProxyPass /public http://localhost:9494/public
    ProxyPassReverse /public http://localhost:9494/public
    
    # Proxy static files dari Next.js (favicon, _next/static, dll)
    # Pastikan ini SEBELUM proxy umum ke frontend
    ProxyPass /favicon.ico http://localhost:3000/favicon.ico
    ProxyPassReverse /favicon.ico http://localhost:3000/favicon.ico
    
    # Proxy semua yang lain ke frontend Next.js (HTTP)
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # Headers
    RequestHeader set X-Forwarded-Proto "http"
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"
</VirtualHost>
```

3. **Enable site and test configuration:**
```bash
a2ensite jnet-monitoring.conf
apache2ctl configtest
systemctl reload apache2
```

4. **Test Apache2 proxy:**
```bash
# Test API
curl http://localhost/api/auth/login

# Test WebSocket (install wscat: npm install -g wscat)
wscat -c "ws://localhost/ws?deviceId=1&token=test123"

# Test public folder
curl http://localhost/public/uploads/avatars/default.jpg
```

### Step 5: Cloudflare Tunnel Setup (Optional)

Jika menggunakan Cloudflare Tunnel untuk akses eksternal:

1. **Install Cloudflare Tunnel:**
```bash
# Follow Cloudflare Tunnel installation guide
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
```

2. **Configure Cloudflare Tunnel:**
* Point Cloudflare Tunnel ke Apache2 (port 80)
* Domain: `yourwebsite.com`
* Target: `http://localhost:80`

3. **Verify:**
* Akses `https://yourwebsite.com` dari browser
* Test WebSocket connection dari browser console

### Step 6: Verify Production Setup

1. **Check all services:**
```bash
# Check PM2 processes
pm2 status

# Check Apache2
systemctl status apache2

# Check MySQL
systemctl status mariadb

# Check ports
netstat -tulpn | grep -E "3000|9494|80"
```

2. **Test from browser:**
* Open `https://yourwebsite.com`
* Login with OTP
* Check WebSocket connection in browser console
* Test all features (dashboard, management, location, etc.)

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
│   │       └── avatars/
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
* **traffic_logs** - Interface traffic logging (all active interfaces)
* **pppoe_usage_logs** - PPPoE user usage statistics
* **downtime_events** - User downtime tracking
* **pppoe_user_status** - Real-time PPPoE user status
* **user_sessions** - Active user sessions
* **dashboard_snapshot** - Cached dashboard data
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

### Assets & Clients
* `GET /api/assets` - List network assets
* `POST /api/assets` - Create asset
* `PUT /api/assets/:id` - Update asset
* `DELETE /api/assets/:id` - Delete asset
* `GET /api/clients` - List clients
* `POST /api/clients` - Create client
* `PUT /api/clients/:id` - Update client
* `DELETE /api/clients/:id` - Delete client

### Import/Export
* `POST /api/import/kml` - Import KML file
* `GET /api/import/kml` - Export KML file

### Reports
* `GET /api/reports/monthly` - Generate monthly PDF report
  * Query parameters: `year`, `month`, `devices` (JSON array), `interfaces` (JSON object), `includeClientStats` (JSON object)

### Workspace
* `GET /api/workspaces/me` - Get workspace info
* `PUT /api/workspaces/set-active-device` - Set active device
* `PUT /api/workspaces/set-main-interface` - Set main interface
* `PUT /api/workspaces/whatsapp-group-id` - Update WhatsApp Group ID
* `GET /api/workspaces/interfaces-by-device` - Get interfaces for device

### WebSocket
* `ws://your-domain.com/ws` - WebSocket connection for real-time updates
  * Query parameters: `deviceId`, `token` (JWT)

---

## 🤖 WhatsApp Bot Setup

1. **Enable WhatsApp Bot:**
   - Go to Settings page in the dashboard
   - Enable "Bot WhatsApp Interaktif"
   - The bot will generate a QR code for initial pairing

2. **Configure Group ID:**
   - In a WhatsApp group, send `.getgroupid`
   - Copy the Group JID from the response (format: `120363424303016733@g.us`)
   - Go to Settings → Bot WhatsApp Interaktif
   - Paste the Group ID and save
   - All notifications will be sent to this group

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
  - Select multiple MikroTik devices
  - Choose specific interfaces per device
  - Option to include client statistics per device

* **Report Content**:
  - SLA & Downtime statistics
  - Bandwidth interface per MikroTik device
  - Client statistics (if enabled)
  - Daily traffic summary
  - Total users count

* **PDF Features**:
  - Professional formatting
  - Repeating table headers on each page
  - Alternating row colors
  - Consistent borders and margins
  - Proper pagination with footers

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
  - All migrations (clients table, notification_sent column, whatsapp_group_id column)
  - Timezone setup
  - Optional seeder (commented out)

**For Existing Databases:**
* Apply individual migration files in order:
  * `migration_add_clients_table.sql`
  * `migration_add_notification_sent_to_downtime_events.sql`
  * `migration_add_whatsapp_group.sql`

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
