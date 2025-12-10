# Eveys Charge Point Simulator - User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [User Interface](#user-interface)
4. [Basic Operations](#basic-operations)
5. [Advanced Features](#advanced-features)
6. [Troubleshooting](#troubleshooting)

## Introduction

Welcome to the Eveys Charge Point Simulator! This tool allows you to simulate a 22kW AC charging station that communicates using the OCPP 1.6J protocol. It's perfect for:

- Testing OCPP central systems
- Developing charging management software
- Training and demonstrations
- Protocol compliance testing
- Load testing with multiple simulators

### Key Features

- ⚡ **Full OCPP 1.6J Support** - All major messages implemented
- 🔐 **Smart Authorization** - Multi-level ID tag authorization
- ⚙️ **90+ Configuration Keys** - Comprehensive OCPP configuration
- 📊 **Real-time Monitoring** - Live power, energy, and status
- 🎭 **Scenario Testing** - Simulate faults and events
- 💾 **Persistent Data** - Survives restarts
- 🌐 **Web Interface** - Beautiful, modern UI with Eveys branding

## Getting Started

### Installation

1. **Prerequisites**

   ```bash
   # Ensure you have Node.js 18+ installed
   node --version  # Should be 18.0.0 or higher
   ```

2. **Install Dependencies**

   ```bash
   # Backend
   cd backend
   npm install

   # Frontend
   cd ../frontend
   npm install
   ```

3. **Configure**

   Edit `backend/.env`:

   ```env
   # Your OCPP central system URL
   OCPP_SERVER_URL=ws://your-server:port/path
   
   # Unique charge point identifier
   CHARGE_POINT_ID=YOUR_CP_ID
   
   # Charging specifications
   MAX_POWER_KW=22
   VOLTAGE=400
   MAX_CURRENT=32
   ```

4. **Run**

   ```bash
   # Terminal 1 - Backend
   cd backend
   npm run dev

   # Terminal 2 - Frontend
   cd frontend
   npm run dev
   ```

5. **Access**

   Open <http://localhost:5173> in your browser

### First Connection

1. The simulator automatically connects to your OCPP server on startup
2. Look for the green "Connected" indicator in the header
3. Check the logs panel for the BootNotification message
4. Your central system should now see the charge point

## User Interface

### Header

- **Eveys Logo** - Company branding
- **Title** - "Charge Point Simulator"
- **Subtitle** - Technical specifications (22kW AC, OCPP 1.6J)
- **Connection Status** - Green (connected) or Red (disconnected)

### Main Tabs

#### Simulator Tab

The main control interface with four sections:

1. **Dashboard** - Status and metrics
2. **Charging Controls** - Start/stop/pause charging
3. **Scenario Simulation** - Test various scenarios
4. **OCPP Message Logs** - Real-time message viewer

#### Configuration Tab

Manage all OCPP configuration keys:

- Search and filter
- View descriptions
- Edit values
- Organized by category

### Dashboard Section

**Connection Status**

- Shows if connected to OCPP server
- Displays connector status (Available/Charging/Faulted)

**Charging Metrics** (when charging)

- Power Output (kW) - Current power delivery
- Energy Delivered (kWh) - Total energy in session
- Duration - Elapsed charging time
- Progress Bar - Visual power indicator

### Charging Controls

**Start Charging**

1. Enter ID Tag (e.g., `TEST-TAG-001`)
2. Click "Start Charging"
3. Authorization flow executes automatically
4. Charging begins if authorized

**During Charging**

- **Pause** - Temporarily suspend (simulates EV pause)
- **Resume** - Continue after pause
- **Stop** - End session

**Manual Consumption**

- Add energy manually for testing
- Choose single or split mode
- Useful for specific test scenarios

### Scenario Simulation

Test various real-world events:

**Network Scenarios**

- **Network Offline** - Disconnect from server
- **Network Online** - Reconnect to server

**User Actions**

- **User Pause (EV)** - Simulate EV-side pause
- **User Resume (EV)** - Resume from EV
- **Connector Unlock** - Unlock during charging

**Fault Scenarios**

- **Emergency Stop** - Immediate fault stop
- **Over Temperature** - Temperature fault
- **Ground Fault** - Ground failure
- **Power Outage** - Power loss
- **Power Restored** - Power recovery

### OCPP Message Logs

**Features**

- Real-time message display
- Color-coded (green=outgoing, blue=incoming)
- Timestamps for each message
- JSON formatting
- Export to file

**Using the Logs**

- Monitor OCPP communication
- Debug integration issues
- Verify message content
- Track message sequence

## Basic Operations

### Starting a Charging Session

1. **Ensure Connected**
   - Check connection status is green
   - Connector should show "Available"

2. **Enter ID Tag**
   - Use one of the default tags:
     - `TEST-TAG-001`
     - `ADMIN-TAG`
     - `DEMO-TAG`
   - Or use a tag from your central system

3. **Click Start Charging**
   - Authorization flow executes
   - If authorized, charging begins
   - Dashboard updates with metrics

4. **Monitor Session**
   - Watch power ramp up to max
   - Energy accumulates
   - Duration counts up
   - Logs show OCPP messages

5. **Stop Charging**
   - Click "Stop Charging"
   - StopTransaction sent
   - Final meter values reported
   - Session summary displayed

### Pausing and Resuming

**To Pause:**

1. Click "Pause Charging" during active session
2. Power drops to zero
3. StatusNotification sent
4. Energy stops accumulating

**To Resume:**

1. Click "Resume Charging"
2. Power ramps back up
3. StatusNotification sent
4. Energy accumulation continues

### Using Scenarios

1. **Select Scenario**
   - Choose from dropdown list
   - Read scenario description

2. **Execute**
   - Click "Execute Scenario"
   - Appropriate OCPP messages sent
   - Status updates in real-time

3. **Observe Results**
   - Check dashboard for status changes
   - Review logs for messages
   - Verify central system response

## Advanced Features

### ID Tag Authorization

The simulator uses a sophisticated authorization system:

**Authorization Flow:**

1. **Cache Check** - Fastest, checks recent authorizations
2. **Local List** - Works offline, persistent whitelist
3. **Central System** - Queries your OCPP server
4. **Offline Behavior** - Configurable for unknown tags

**Managing Authorization:**

**Default Tags** (pre-configured)

- `TEST-TAG-001` - General testing
- `ADMIN-TAG` - Admin access
- `DEMO-TAG` - Demonstration purposes

**Adding Tags** (via central system)

- Use SendLocalList OCPP command
- Tags persist across restarts
- Support expiry dates
- Support parent ID tags

**Authorization Features:**

- ✅ Concurrent transaction prevention
- ✅ Tag expiry validation
- ✅ Offline operation
- ✅ Performance caching

### Configuration Management

Access via Configuration tab:

**Viewing Configuration:**

1. Click "Configuration" tab
2. Browse by category or search
3. View current values and descriptions

**Changing Configuration:**

1. Find the key you want to change
2. Click "Edit" button
3. Enter new value
4. Changes apply immediately

**Important Keys:**

**Core Settings:**

- `HeartbeatInterval` - How often to send heartbeat (seconds)
- `MeterValueSampleInterval` - Meter value frequency (seconds)
- `MeterValuesSampledData` - Which measurands to report

**Authorization:**

- `LocalAuthListEnabled` - Enable/disable local list
- `AuthorizationCacheEnabled` - Enable/disable caching
- `AllowOfflineTxForUnknownId` - Allow unknown tags offline

**Transaction:**

- `TransactionMessageAttempts` - Retry count
- `TransactionMessageRetryInterval` - Retry delay
- `StopTransactionOnEVSideDisconnect` - Auto-stop behavior

### Transaction History

View past charging sessions:

**Accessing History:**

- Available via API: `GET /api/transactions/history`
- Shows recent transactions
- Includes start/stop times, energy, duration

**Statistics:**

- Total energy delivered
- Number of sessions
- Average session duration
- Available via: `GET /api/transactions/stats`

### Manual Consumption

For testing specific scenarios:

**Single Mode:**

1. Enter energy amount (kWh)
2. Click "Add Consumption"
3. Energy added instantly
4. MeterValues sent

**Split Mode:**

1. Enter total energy
2. Enter number of parts
3. Energy divided and sent in parts
4. Useful for testing meter value sequences

### Offline Operation

The simulator can operate without central system connection:

**Offline Features:**

- Local authorization list still works
- Meter values accumulate
- Messages queued for later
- Auto-send when reconnected

**Configuration:**

- Set `AllowOfflineTxForUnknownId` to allow/deny unknown tags
- Local list always works offline
- Cached authorizations work offline

### Remote Operations

Your central system can remotely control the simulator:

**RemoteStartTransaction:**

- Central system initiates charging
- Simulator authorizes ID tag
- Charging starts automatically

**RemoteStopTransaction:**

- Central system stops charging
- Transaction ends gracefully
- Final values reported

**ChangeConfiguration:**

- Central system updates config
- Changes apply immediately
- Confirmation sent

**UnlockConnector:**

- Central system unlocks connector
- Simulates physical unlock
- Status updated

## Troubleshooting

### Connection Issues

**Problem:** Cannot connect to OCPP server

**Solutions:**

1. Check `OCPP_SERVER_URL` in `.env`
2. Verify server is running and accessible
3. Check firewall settings
4. Review logs for error messages
5. Try manual connect button

**Problem:** Connected but no heartbeat

**Solutions:**

1. Check `HeartbeatInterval` configuration
2. Verify server accepts heartbeat
3. Review logs for responses
4. Check network stability

### Authorization Issues

**Problem:** ID tag rejected

**Solutions:**

1. Check tag is in local authorization list
2. Verify tag not expired
3. Check central system whitelist
4. Review authorization cache
5. Check `AllowOfflineTxForUnknownId` if offline

**Problem:** Concurrent transaction error

**Solutions:**

1. Stop existing transaction first
2. Check transaction history
3. Clear authorization cache
4. Restart simulator if needed

### Charging Issues

**Problem:** Charging won't start

**Solutions:**

1. Verify connector status is "Available"
2. Check authorization succeeded
3. Review OCPP server response
4. Check configuration keys
5. Review logs for errors

**Problem:** Power not ramping up

**Solutions:**

1. Check `CurrentLimiterValue` configuration
2. Verify max power settings
3. Review power calculation logic
4. Check for fault conditions

### Configuration Issues

**Problem:** Configuration changes not applied

**Solutions:**

1. Check key is not read-only
2. Verify value format is correct
3. Review validation rules
4. Check file permissions
5. Restart simulator

**Problem:** Configuration reset after restart

**Solutions:**

1. Check data directory exists
2. Verify file write permissions
3. Review configuration file
4. Check for errors in logs

### UI Issues

**Problem:** Dashboard not updating

**Solutions:**

1. Check WebSocket connection
2. Refresh browser page
3. Clear browser cache
4. Check browser console for errors
5. Verify backend is running

**Problem:** Logs not showing messages

**Solutions:**

1. Check OCPP connection
2. Verify messages are being sent
3. Clear and refresh logs
4. Check WebSocket connection
5. Review backend logs

## Best Practices

### Testing

1. **Start Simple** - Test basic start/stop first
2. **Use Scenarios** - Test edge cases systematically
3. **Monitor Logs** - Always check OCPP messages
4. **Verify Central System** - Confirm server receives messages
5. **Test Offline** - Verify offline behavior

### Configuration

1. **Document Changes** - Note configuration modifications
2. **Test Impact** - Verify changes have desired effect
3. **Backup Config** - Save working configurations
4. **Use Defaults** - Start with standard values
5. **Incremental Changes** - Change one thing at a time

### Authorization

1. **Use Local List** - For offline reliability
2. **Set Expiry** - Use tag expiration for security
3. **Monitor Cache** - Check cache hit rates
4. **Test Offline** - Verify offline authorization
5. **Clear Cache** - When testing authorization changes

### Development

1. **Use Dev Mode** - Hot reload for faster iteration
2. **Check Logs** - Both frontend and backend
3. **Test Scenarios** - Use scenario engine
4. **Monitor Network** - Use browser dev tools
5. **Version Control** - Track configuration changes

## API Reference

For programmatic control, see API endpoints:

**Status & Control:**

- `GET /api/status` - Current status
- `POST /api/connect` - Connect to server
- `POST /api/disconnect` - Disconnect

**Charging:**

- `POST /api/start-charging` - Start session
- `POST /api/stop-charging` - Stop session
- `POST /api/pause-charging` - Pause
- `POST /api/resume-charging` - Resume

**Configuration:**

- `GET /api/config` - Get configuration
- `POST /api/config` - Update configuration

**Scenarios:**

- `GET /api/scenarios` - List scenarios
- `POST /api/simulate-scenario` - Execute scenario

**History:**

- `GET /api/transactions/history` - Transaction history
- `GET /api/transactions/stats` - Statistics

## Support

For issues or questions:

1. Check this user guide
2. Review [FEATURES.md](../FEATURES.md) for detailed feature documentation
3. Check [README.md](../README.md) for quick start
4. Review logs for error messages
5. Contact Eveys support

---

**Eveys - Powering the future of electric mobility**
