# ⚡ Eveys Charge Point Simulator

A comprehensive OCPP 1.6J charge point simulator with a beautiful web-based control panel for testing and simulating various charging scenarios. Built by Eveys for EV charging innovation.

![Eveys Logo](frontend/src/assets/eveys-white.svg)

## 🌟 Features

### Core OCPP Functionality

- **Full OCPP 1.6J Protocol Support** - Complete implementation of WebSocket-based OCPP communication
- **22kW AC Charging Simulation** - Realistic power delivery and energy consumption simulation with configurable ramp-up
- **Real-time Monitoring** - Live dashboard with power output, energy delivered, and session duration
- **Comprehensive Logging** - All OCPP messages logged with timestamps and direction indicators

### Advanced Features

#### 🔐 ID Tag Authorization System

- **Local Authorization List** - Persistent whitelist of authorized ID tags for offline operation
- **Authorization Cache** - TTL-based caching of authorization responses with LRU eviction
- **Smart Authorization Flow** - Hierarchical check: cache → local list → central system
- **Concurrent Transaction Prevention** - Prevents same ID tag from starting multiple transactions
- **Tag Expiry Validation** - Automatic rejection of expired ID tags
- **Default Test Tags** - Pre-loaded with `TEST-TAG-001`, `ADMIN-TAG`, and `DEMO-TAG`

#### ⚙️ Configuration Management

- **90+ OCPP Configuration Keys** - Full support for standard and vendor-specific keys
- **Real-time Configuration** - Live updates to charging behavior
- **Persistent Storage** - Configuration saved per charge point ID
- **Web UI Management** - Search, filter, and edit configuration keys
- **Categories** - Organized by Core, Security, Smart Charging, Local Auth List, and more

#### 📊 Transaction Management

- **Persistent Meter Values** - Meter readings survive simulator restarts
- **Transaction History** - Track all charging sessions with detailed statistics
- **Transaction Tracker** - Monitor active transactions across restarts
- **Offline Data Buffer** - Queue messages when disconnected, send when reconnected
- **Manual Consumption** - Manually add energy consumption for testing

#### 🎭 Scenario Simulation

Test various real-world scenarios:

- Emergency stop button
- Network offline/online transitions
- User pause/resume from car
- Connector unlock during charging
- Over-temperature conditions
- Ground fault detection
- Power outage and recovery

### UI/UX

- **Beautiful Modern UI** - Dark theme with gradients, animations, and responsive design
- **Eveys Branding** - Professional logo integration and consistent branding
- **WebSocket Real-time Updates** - Instant updates to the control panel
- **Configuration Panel** - Comprehensive UI for managing all OCPP settings
- **Export Functionality** - Download logs and transaction history

## 📋 Prerequisites

- Node.js 18+ and npm
- An OCPP 1.6J Central System (e.g., [SteVe](https://github.com/steve-community/steve), ChargeCloud, or any OCPP-compliant backend)

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Navigate to project directory
cd ocpp-chargepoint-simulator

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure

Edit `backend/.env` file:

```env
# OCPP Central System Configuration
OCPP_SERVER_URL=ws://dev.toger.co:5080
CHARGE_POINT_ID=AE0022G1GNAC00617X

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
```

### 3. Run

**Terminal 1 - Backend:**

```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**

```bash
cd frontend
npm run dev
```

### 4. Access

Open your browser to **<http://localhost:5173>**

## 🎮 Usage

### Connecting to OCPP Server

1. The simulator automatically connects on startup
2. BootNotification is sent with Eveys vendor information
3. Heartbeat starts automatically
4. Connection status updates in real-time

### Starting a Charging Session

1. Enter an ID Tag (default: `TEST-TAG-001`, `ADMIN-TAG`, or `DEMO-TAG`)
2. Click **"Start Charging"**
3. Authorization flow executes:
   - Checks authorization cache
   - Checks local authorization list
   - Queries central system if needed
4. Watch real-time power output, energy delivered, and session duration
5. OCPP messages appear in the logs panel

### Managing Authorization

The simulator includes a built-in authorization system:

- **Local Authorization List**: Whitelist of authorized tags (works offline)
- **Authorization Cache**: Speeds up repeated authorizations
- **Concurrent Transaction Check**: Prevents duplicate sessions
- **Tag Expiry**: Automatic validation of expiration dates

### Configuration Management

Access the Configuration tab to:

- View all 90+ OCPP configuration keys
- Search and filter by category
- Edit values in real-time
- See detailed descriptions for each key
- Changes take effect immediately

### Controlling Charging

- **Pause** - Temporarily suspend charging (simulates EV pause)
- **Resume** - Continue charging after pause
- **Stop** - End the charging session
- **Manual Consumption** - Add energy manually for testing

### Simulating Scenarios

Use the Scenario Simulation panel to test various conditions:

- **Emergency Stop** - Immediate fault and transaction stop
- **Network Offline** - Disconnect from OCPP server
- **Network Online** - Reconnect to OCPP server
- **User Pause (EV)** - Simulate user pausing from car
- **User Resume (EV)** - Simulate user resuming from car
- **Connector Unlock** - Unlock connector during charging
- **Over Temperature** - Temperature fault condition
- **Ground Fault** - Ground failure detection
- **Power Outage** - Simulate power loss
- **Power Restored** - Simulate power recovery

## 📊 OCPP Messages Supported

### Charge Point Initiated

- ✅ BootNotification (with Eveys vendor info)
- ✅ Heartbeat
- ✅ StatusNotification
- ✅ StartTransaction
- ✅ StopTransaction
- ✅ MeterValues (with configurable measurands)
- ✅ Authorize
- ✅ DataTransfer

### Central System Initiated

- ✅ RemoteStartTransaction
- ✅ RemoteStopTransaction
- ✅ UnlockConnector
- ✅ GetConfiguration
- ✅ ChangeConfiguration
- ✅ Reset
- ✅ TriggerMessage
- ✅ SendLocalList
- ✅ GetLocalListVersion

## 🏗️ Architecture

```
eveys-chargepoint-simulator/
├── backend/                    # Node.js + TypeScript backend
│   ├── src/
│   │   ├── ocpp/              # OCPP protocol implementation
│   │   │   ├── ChargePoint.ts           # WebSocket client
│   │   │   ├── TransactionManager.ts    # Session management
│   │   │   ├── ConfigurationManager.ts  # OCPP configuration
│   │   │   ├── AuthorizationManager.ts  # ID tag authorization
│   │   │   ├── LocalAuthList.ts         # Local whitelist
│   │   │   ├── AuthorizationCache.ts    # Authorization caching
│   │   │   ├── MeterValueStorage.ts     # Persistent meter values
│   │   │   ├── TransactionTracker.ts    # Active transaction tracking
│   │   │   ├── TransactionHistory.ts    # Historical transactions
│   │   │   └── OfflineDataBuffer.ts     # Offline message queue
│   │   ├── simulation/        # Scenario engine
│   │   ├── api/               # REST API and WebSocket
│   │   └── models/            # Data models
│   ├── data/                  # Persistent data storage
│   └── package.json
└── frontend/                   # React + TypeScript frontend
    ├── src/
    │   ├── components/        # UI components
    │   │   ├── Dashboard.tsx
    │   │   ├── ChargingControls.tsx
    │   │   ├── LogsViewer.tsx
    │   │   ├── ScenarioPanel.tsx
    │   │   ├── ConfigurationPanel.tsx
    │   │   └── ManualConsumption.tsx
    │   ├── services/          # API client
    │   └── assets/            # Eveys branding assets
    └── package.json
```

## 🔧 API Endpoints

### Core Operations

- `GET /api/status` - Get current charge point status
- `POST /api/connect` - Connect to OCPP server
- `POST /api/disconnect` - Disconnect from server
- `POST /api/heartbeat` - Send manual heartbeat

### Charging Control

- `POST /api/start-charging` - Start charging session
- `POST /api/stop-charging` - Stop charging session
- `POST /api/pause-charging` - Pause charging
- `POST /api/resume-charging` - Resume charging
- `POST /api/manual-consumption` - Add manual energy consumption

### Configuration

- `GET /api/config` - Get OCPP configuration
- `POST /api/config` - Update configuration key

### Authorization (Planned)

- `GET /api/auth/local-list` - Get local authorization list
- `POST /api/auth/local-list` - Add ID tag to local list
- `DELETE /api/auth/local-list/:idTag` - Remove ID tag
- `POST /api/auth/clear-cache` - Clear authorization cache
- `GET /api/auth/cache` - View cache contents
- `GET /api/auth/stats` - Get authorization statistics

### Scenarios

- `POST /api/simulate-scenario` - Execute scenario
- `GET /api/scenarios` - Get available scenarios

### Transaction History

- `GET /api/transactions/history` - Get transaction history
- `GET /api/transactions/stats` - Get transaction statistics

### Data Transfer

- `POST /api/data-transfer` - Send custom data transfer message

## 🌐 WebSocket Events

Connect to `ws://localhost:3001/ws` for real-time updates:

- `status` - Charge point status updates
- `session` - Charging session updates
- `log` - OCPP message logs
- `event` - System events (connected, disconnected, transactionStarted, etc.)

## 📝 Configuration Keys

The simulator supports 90+ OCPP configuration keys organized by category:

### Core Configuration

- `HeartbeatInterval` - Heartbeat frequency (seconds)
- `MeterValueSampleInterval` - Meter value reporting interval
- `MeterValuesSampledData` - Measurands to include (Energy.Active.Import.Register, Power.Active.Import, Current.Import, Voltage, SoC, Temperature)
- `StopTransactionOnEVSideDisconnect` - Auto-stop on disconnect
- `ConnectionTimeOut` - WebSocket connection timeout

### Authorization

- `LocalAuthListEnabled` - Enable local authorization list
- `LocalAuthListMaxLength` - Maximum entries in local list
- `AuthorizationCacheEnabled` - Enable authorization caching
- `AllowOfflineTxForUnknownId` - Allow unknown tags when offline

### Transaction Management

- `TransactionMessageAttempts` - Retry attempts for transaction messages
- `TransactionMessageRetryInterval` - Retry interval in seconds
- `StopTxnAlignedData` - Measurands for stop transaction
- `StopTxnSampledData` - Sampled data for stop transaction

### Smart Charging

- `ChargeProfileMaxStackLevel` - Maximum stack level
- `ChargingScheduleAllowedChargingRateUnit` - Allowed rate units
- `MaxChargingProfilesInstalled` - Maximum profiles

And many more... See Configuration Panel for full list.

## 🎨 UI Features

- **Modern Dark Theme** - Beautiful gradient backgrounds with Eveys branding
- **Real-time Metrics** - Live power, energy, and duration displays
- **Progress Indicators** - Visual power output progress bar
- **Message Logs** - Color-coded incoming/outgoing messages with export
- **Configuration Management** - Search, filter, and edit 90+ config keys
- **Transaction History** - View past charging sessions
- **Responsive Design** - Works on desktop and tablet

## 🧪 Testing with SteVe

To test with [SteVe](https://github.com/steve-community/steve):

1. Install and run SteVe (default: <http://localhost:8180>)
2. Add charge point with your CHARGE_POINT_ID
3. Set OCPP_SERVER_URL to `ws://localhost:8180/steve/websocket/CentralSystemService/{CHARGE_POINT_ID}`
4. Simulator connects automatically
5. Use SteVe web interface to:
   - Send RemoteStartTransaction
   - Change configuration
   - Update local authorization list
   - Monitor transactions

## 🛠️ Development

### Backend Development

```bash
cd backend
npm run dev    # Run with hot reload
npm run build  # Build for production
npm start      # Run production build
```

### Frontend Development

```bash
cd frontend
npm run dev    # Run development server
npm run build  # Build for production
```

## 📦 Production Build

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd frontend
npm run build

# Run production
cd backend
npm start
```

## 🔒 Security Features

- **ID Tag Authorization** - Multi-level authorization with cache and local list
- **Concurrent Transaction Prevention** - One transaction per ID tag
- **Tag Expiry Validation** - Automatic expiration checking
- **Offline Operation** - Local authorization list works without central system
- **Secure Configuration** - Protected configuration keys

## 📈 Performance Features

- **Authorization Caching** - Reduces central system load
- **Persistent Storage** - Meter values and transactions survive restarts
- **Offline Buffer** - Queues messages when disconnected
- **Configurable Intervals** - Optimize network usage
- **LRU Cache Eviction** - Efficient memory management

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

MIT License

## 🙏 Acknowledgments

- OCPP 1.6J Specification by Open Charge Alliance
- React and Vite for the amazing developer experience
- Lucide React for beautiful icons
- TypeScript for type safety

---

**Made with ⚡ by Eveys for EV charging innovation**

*Eveys - Powering the future of electric mobility*
