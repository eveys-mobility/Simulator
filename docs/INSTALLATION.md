# Eveys Charge Point Simulator - Installation Guide

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Pre-Installation Checklist](#pre-installation-checklist)
3. [Installation Methods](#installation-methods)
4. [Step-by-Step Installation](#step-by-step-installation)
5. [Configuration](#configuration)
6. [Verification](#verification)
7. [Troubleshooting](#troubleshooting)
8. [Next Steps](#next-steps)

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| **Operating System** | Windows 10+, macOS 10.15+, Linux (Ubuntu 20.04+, CentOS 8+) |
| **Node.js** | 18.0.0 or higher |
| **npm** | 9.0.0 or higher |
| **Memory** | 512MB RAM |
| **Storage** | 500MB free space |
| **Network** | Internet connection for installation |
| **Browser** | Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ |

### Recommended Requirements

| Component | Requirement |
|-----------|-------------|
| **Operating System** | Latest stable version |
| **Node.js** | Latest LTS version (20.x) |
| **npm** | Latest stable version |
| **Memory** | 1GB+ RAM |
| **Storage** | 1GB+ free space |
| **Network** | Stable broadband connection |
| **Browser** | Latest version of Chrome or Firefox |

### Network Requirements

- **Outbound WebSocket** - Port 80/443 or custom port for OCPP server
- **Inbound HTTP** - Port 3001 for backend API (configurable)
- **Inbound HTTP** - Port 5173 for frontend (development)
- **Firewall** - Allow WebSocket connections to your OCPP central system

## Pre-Installation Checklist

Before installing Eveys CPS, ensure you have:

- [ ] **Node.js installed** - Version 18.0.0 or higher
- [ ] **npm installed** - Version 9.0.0 or higher
- [ ] **Git installed** - For cloning the repository
- [ ] **Text editor** - VS Code, Sublime Text, or similar
- [ ] **OCPP Central System** - URL and credentials (if required)
- [ ] **Charge Point ID** - Unique identifier for your simulator
- [ ] **Network access** - Ability to reach OCPP server
- [ ] **Admin privileges** - For installing global packages (if needed)

### Verify Prerequisites

```bash
# Check Node.js version
node --version
# Should output: v18.0.0 or higher

# Check npm version
npm --version
# Should output: 9.0.0 or higher

# Check Git version
git --version
# Should output: git version 2.x.x or higher
```

If any prerequisite is missing, install it before proceeding.

## Installation Methods

### Method 1: Git Clone (Recommended)

**Best for:** Developers, contributors, staying up-to-date

```bash
git clone https://github.com/eveys/charge-point-simulator.git
cd charge-point-simulator
```

**Advantages:**

- Easy to update (`git pull`)
- Can contribute changes
- Full git history

### Method 2: Download ZIP

**Best for:** Quick testing, no git required

1. Visit: <https://github.com/eveys/charge-point-simulator>
2. Click "Code" → "Download ZIP"
3. Extract to desired location
4. Open terminal in extracted folder

**Advantages:**

- No git required
- Simple download
- Offline installation possible

### Method 3: npm Package (Future)

**Coming soon:** `npm install -g @eveys/charge-point-simulator`

## Step-by-Step Installation

### Step 1: Obtain the Source Code

**Using Git (Recommended):**

```bash
# Clone the repository
git clone https://github.com/eveys/charge-point-simulator.git

# Navigate to the directory
cd charge-point-simulator

# Verify contents
ls -la
# Should see: backend/, frontend/, README.md, etc.
```

**Using ZIP Download:**

```bash
# Extract the ZIP file
unzip charge-point-simulator-main.zip

# Navigate to the directory
cd charge-point-simulator-main

# Verify contents
ls -la
```

### Step 2: Install Backend Dependencies

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# This will install:
# - express (web server)
# - ws (WebSocket)
# - cors (cross-origin support)
# - dotenv (environment variables)
# - TypeScript and type definitions
# - Development tools (tsx for hot reload)

# Wait for installation to complete
# Should see: "added XXX packages"
```

**Expected Output:**

```
added 245 packages, and audited 246 packages in 15s

42 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

**If you encounter errors:**

- Check Node.js version: `node --version`
- Clear npm cache: `npm cache clean --force`
- Delete `node_modules` and retry: `rm -rf node_modules && npm install`

### Step 3: Install Frontend Dependencies

```bash
# Navigate to frontend directory
cd ../frontend

# Install dependencies
npm install

# This will install:
# - react (UI framework)
# - react-dom (React rendering)
# - recharts (charting library)
# - lucide-react (icons)
# - Vite (build tool)
# - TypeScript and type definitions

# Wait for installation to complete
```

**Expected Output:**

```
added 198 packages, and audited 199 packages in 12s

38 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

### Step 4: Configure Environment Variables

```bash
# Navigate back to backend
cd ../backend

# Create environment file
cp .env.example .env

# Or create manually
cat > .env << 'EOF'
# OCPP Central System Configuration
OCPP_SERVER_URL=ws://your-server.com:port/path
CHARGE_POINT_ID=YOUR_CHARGE_POINT_ID

# Charge Point Configuration
MAX_POWER_KW=22
CONNECTOR_TYPE=Type2
VOLTAGE=400
MAX_CURRENT=32

# API Server Configuration
API_PORT=3001
FRONTEND_URL=http://localhost:5173

# Simulation Settings
METER_VALUE_INTERVAL=60
HEARTBEAT_INTERVAL=300
EOF
```

**Edit the `.env` file:**

```bash
# Open in your preferred editor
nano .env
# or
code .env
# or
vim .env
```

**Required Configuration:**

| Variable | Description | Example |
|----------|-------------|---------|
| `OCPP_SERVER_URL` | WebSocket URL of your OCPP central system | `ws://dev.toger.co:5080` |
| `CHARGE_POINT_ID` | Unique identifier for this charge point | `CP001` or `AE0022G1GNAC00617X` |

**Optional Configuration:**

| Variable | Description | Default |
|----------|-------------|---------|
| `MAX_POWER_KW` | Maximum charging power | `22` |
| `CONNECTOR_TYPE` | Connector type | `Type2` |
| `VOLTAGE` | Line voltage | `400` |
| `MAX_CURRENT` | Maximum current | `32` |
| `API_PORT` | Backend API port | `3001` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:5173` |
| `METER_VALUE_INTERVAL` | Meter value reporting interval (seconds) | `60` |
| `HEARTBEAT_INTERVAL` | Heartbeat interval (seconds) | `300` |

**Configuration Examples:**

**Example 1: Testing with SteVe**

```env
OCPP_SERVER_URL=ws://localhost:8180/steve/websocket/CentralSystemService
CHARGE_POINT_ID=CP001
```

**Example 2: Production Server**

```env
OCPP_SERVER_URL=wss://charging.example.com:443/ocpp
CHARGE_POINT_ID=EVEYS-CP-001
```

**Example 3: Development Server**

```env
OCPP_SERVER_URL=ws://dev.toger.co:5080
CHARGE_POINT_ID=AE0022G1GNAC00617X
```

### Step 5: Build (Optional for Development)

For development, you can skip this step and use `npm run dev`.

For production deployment:

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd ../frontend
npm run build
```

## Running the Simulator

### Development Mode (Recommended for Testing)

**Terminal 1 - Backend:**

```bash
cd backend
npm run dev

# Expected output:
# [ConfigurationManager] Loaded configuration
# [MeterValueStorage] Loaded meter values
# [LocalAuthList] Loaded authorization list
# [AuthorizationManager] Initialized
# [Server] OCPP Charge Point Simulator API running on port 3001
# [Server] Charge Point ID: YOUR_CHARGE_POINT_ID
# [Server] OCPP Server URL: ws://your-server.com
# [ChargePoint] Connected to ws://your-server.com/YOUR_CHARGE_POINT_ID
# [ChargePoint] Sent BootNotification
```

**Terminal 2 - Frontend:**

```bash
cd frontend
npm run dev

# Expected output:
# VITE v5.0.8  ready in 324 ms
# ➜  Local:   http://localhost:5173/
# ➜  Network: use --host to expose
# ➜  press h to show help
```

**Access the Simulator:**
Open your browser to: **<http://localhost:5173>**

### Production Mode

```bash
# Start backend (after building)
cd backend
npm start

# Serve frontend (requires web server)
cd frontend
# Use nginx, Apache, or serve package
npx serve -s dist -p 5173
```

## Verification

### 1. Verify Backend is Running

```bash
# Test API endpoint
curl http://localhost:3001/api/status

# Expected response:
# {"connected":true,"sessions":[],"connectors":[{"id":1,"status":"Available","hasActiveSession":false}]}
```

### 2. Verify OCPP Connection

Check backend logs for:

```
[ChargePoint] Connected to ws://your-server.com/YOUR_CHARGE_POINT_ID
[ChargePoint] Sent BootNotification: {
  chargePointVendor: 'Eveys',
  chargePointModel: 'Eveys-22kW-AC',
  ...
}
```

### 3. Verify Frontend is Accessible

1. Open <http://localhost:5173>
2. Should see Eveys logo and "Charge Point Simulator" header
3. Connection status should show "Connected" (green)
4. Connector should show "Available"

### 4. Test Basic Functionality

1. **Test Heartbeat:**
   - Click "Send Heartbeat" (if available)
   - Check logs for heartbeat message

2. **Test Charging:**
   - Enter ID tag: `TEST-TAG-001`
   - Click "Start Charging"
   - Should see authorization and transaction start
   - Power should ramp up
   - Energy should accumulate

3. **Test Configuration:**
   - Click "Configuration" tab
   - Search for "HeartbeatInterval"
   - Should see current value
   - Try editing (optional)

## Troubleshooting

### Installation Issues

#### Problem: npm install fails

**Error:** `npm ERR! code EACCES`

**Solution:**

```bash
# Fix npm permissions
sudo chown -R $USER:$GROUP ~/.npm
sudo chown -R $USER:$GROUP ~/.config

# Retry installation
npm install
```

#### Problem: Node.js version too old

**Error:** `error @eveys/cps@1.0.0: The engine "node" is incompatible`

**Solution:**

```bash
# Install Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node.js 20 LTS
nvm install 20
nvm use 20

# Verify version
node --version

# Retry installation
npm install
```

#### Problem: Port already in use

**Error:** `Error: listen EADDRINUSE: address already in use :::3001`

**Solution:**

```bash
# Find process using port 3001
lsof -ti:3001

# Kill the process
kill -9 $(lsof -ti:3001)

# Or change port in .env
# API_PORT=3002
```

### Connection Issues

#### Problem: Cannot connect to OCPP server

**Symptoms:**

- Backend logs show connection errors
- Frontend shows "Disconnected"

**Solutions:**

1. **Check OCPP_SERVER_URL:**

   ```bash
   # Verify URL format
   # Correct: ws://server:port/path
   # Wrong: ws://server:port/path/ (trailing slash)
   ```

2. **Test server connectivity:**

   ```bash
   # Test if server is reachable
   ping your-server.com
   
   # Test WebSocket connection
   wscat -c ws://your-server.com:port/path
   ```

3. **Check firewall:**

   ```bash
   # Ensure WebSocket port is open
   # Check with your network administrator
   ```

4. **Verify charge point ID:**
   - Ensure CHARGE_POINT_ID is registered in central system
   - Check for typos
   - Verify case sensitivity

#### Problem: Frontend cannot reach backend

**Symptoms:**

- Frontend loads but shows errors
- API calls fail

**Solutions:**

1. **Verify backend is running:**

   ```bash
   curl http://localhost:3001/api/status
   ```

2. **Check CORS configuration:**
   - Verify FRONTEND_URL in .env matches frontend URL
   - Default: `http://localhost:5173`

3. **Check browser console:**
   - Open browser DevTools (F12)
   - Check Console tab for errors
   - Check Network tab for failed requests

### Runtime Issues

#### Problem: Charging won't start

**Solutions:**

1. **Check connection:**
   - Ensure "Connected" status is green
   - Verify OCPP server is responding

2. **Check authorization:**
   - Use default tags: `TEST-TAG-001`, `ADMIN-TAG`, `DEMO-TAG`
   - Check if tag is in local authorization list
   - Verify central system accepts the tag

3. **Check connector status:**
   - Must be "Available" to start
   - If "Faulted", check logs for errors

4. **Check logs:**
   - Backend terminal for errors
   - Frontend logs panel for OCPP messages

## Post-Installation

### 1. Configure for Your Environment

Edit `backend/.env` with your specific settings:

- OCPP server URL
- Charge point ID
- Power specifications
- Intervals and timeouts

### 2. Add to Local Authorization List

Default tags are pre-loaded, but you can add more via:

- OCPP `SendLocalList` command from central system
- API endpoints (when implemented)
- Direct file edit: `backend/data/local_auth_list_{chargePointId}.json`

### 3. Customize Configuration

Access Configuration tab to customize:

- Heartbeat interval
- Meter value interval
- Measurands to report
- Authorization settings
- Transaction behavior

### 4. Test Scenarios

Try built-in scenarios:

- Emergency stop
- Network offline/online
- User pause/resume
- Connector unlock
- Fault conditions

## Next Steps

1. **Read the User Guide** - [USER_GUIDE.md](USER_GUIDE.md)
2. **Explore Features** - [FEATURES.md](../FEATURES.md)
3. **Review Best Practices** - [BEST_PRACTICES.md](BEST_PRACTICES.md)
4. **Check API Reference** - [API_REFERENCE.md](API_REFERENCE.md)
5. **Learn Architecture** - [ARCHITECTURE.md](ARCHITECTURE.md)

## Support

If you encounter issues not covered in this guide:

1. Check [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Review [FAQ](FAQ.md)
3. Search [GitHub Issues](https://github.com/eveys/charge-point-simulator/issues)
4. Contact support: <support@eveys.com>

---

*Eveys - Powering the future of electric mobility*
