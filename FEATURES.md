# Eveys Charge Point Simulator - Features Documentation

## Overview

The Eveys Charge Point Simulator is a comprehensive OCPP 1.6J testing tool with advanced features for simulating real-world charging scenarios, managing configurations, and testing authorization flows.

## Core Features

### 1. OCPP 1.6J Protocol Implementation

#### Supported Messages

**Charge Point Initiated:**

- `BootNotification` - Sends Eveys vendor information
- `Heartbeat` - Configurable interval
- `StatusNotification` - Real-time connector status updates
- `StartTransaction` - With authorization flow
- `StopTransaction` - With transaction data
- `MeterValues` - Configurable measurands
- `Authorize` - ID tag authorization
- `DataTransfer` - Custom vendor data

**Central System Initiated:**

- `RemoteStartTransaction` - Remote charging initiation
- `RemoteStopTransaction` - Remote charging termination
- `UnlockConnector` - Connector unlock command
- `GetConfiguration` - Retrieve configuration keys
- `ChangeConfiguration` - Update configuration
- `Reset` - Soft/Hard reset
- `TriggerMessage` - Trigger specific messages
- `SendLocalList` - Update local authorization list
- `GetLocalListVersion` - Query list version

### 2. ID Tag Authorization System

#### Authorization Flow

```
1. Check Authorization Cache (if enabled)
   ├─ Hit → Return cached result
   └─ Miss → Continue

2. Check Local Authorization List (if enabled)
   ├─ Found → Check expiry → Return result
   └─ Not found → Continue

3. Query Central System (if connected)
   ├─ Success → Cache result → Return
   └─ Offline → Check AllowOfflineTxForUnknownId

4. Offline Behavior
   ├─ AllowOfflineTxForUnknownId=true → Accept
   └─ AllowOfflineTxForUnknownId=false → Reject
```

#### Components

**LocalAuthList**

- Persistent storage per charge point
- Supports parent ID tags
- Expiry date validation
- Version tracking for OCPP compliance
- Default test tags: `TEST-TAG-001`, `ADMIN-TAG`, `DEMO-TAG`

**AuthorizationCache**

- TTL-based expiration (default: 24 hours)
- LRU eviction (default: 100 entries)
- Automatic cleanup of expired entries
- Statistics tracking

**AuthorizationManager**

- Orchestrates authorization flow
- Prevents concurrent transactions
- Validates tag expiry
- Tracks active transactions

#### Features

- ✅ **Offline Operation** - Works without central system
- ✅ **Concurrent Prevention** - One transaction per ID tag
- ✅ **Tag Expiry** - Automatic validation
- ✅ **Performance** - Caching reduces central system load
- ✅ **Compliance** - Full OCPP 1.6J support

### 3. Configuration Management

#### Overview

Supports 90+ OCPP configuration keys organized by category:

**Categories:**

- Core Configuration
- Security & Authorization
- Smart Charging
- Local Authorization List
- Transaction Management
- Meter Values
- Clock & Time
- Firmware Management
- Diagnostics
- Reservation
- Vendor Specific

#### Key Features

- **Real-time Updates** - Changes take effect immediately
- **Persistent Storage** - Saved per charge point ID
- **Web UI** - Search, filter, and edit
- **Validation** - Type checking and constraints
- **Descriptions** - Detailed help for each key

#### Important Keys

**Core:**

- `HeartbeatInterval` - Heartbeat frequency (default: 60s)
- `MeterValueSampleInterval` - Meter value interval (default: 60s)
- `MeterValuesSampledData` - Measurands to report
- `ConnectionTimeOut` - WebSocket timeout (default: 30s)

**Authorization:**

- `LocalAuthListEnabled` - Enable local list (default: true)
- `LocalAuthListMaxLength` - Max entries (default: 100)
- `AuthorizationCacheEnabled` - Enable cache (default: true)
- `AllowOfflineTxForUnknownId` - Offline behavior (default: false)

**Transaction:**

- `TransactionMessageAttempts` - Retry count (default: 3)
- `TransactionMessageRetryInterval` - Retry delay (default: 20s)
- `StopTransactionOnEVSideDisconnect` - Auto-stop (default: true)

**Meter Values:**

- `MeterValuesSampledData` - Energy, Power, Current, Voltage, SoC, Temperature
- `StopTxnSampledData` - Data for stop transaction
- `ClockAlignedDataInterval` - Aligned reporting interval

### 4. Transaction Management

#### Persistent Meter Values

- **Storage** - Meter values saved to disk
- **Survival** - Persists across restarts
- **Per Connector** - Independent tracking
- **Accuracy** - Maintains continuity

#### Transaction History

- **Recording** - All transactions logged
- **Details** - Start/stop time, energy, duration
- **Statistics** - Total energy, session count
- **Retention** - Configurable history size

#### Transaction Tracker

- **Active Monitoring** - Tracks ongoing transactions
- **Orphan Detection** - Finds incomplete transactions
- **Recovery** - Resume after restart
- **Cleanup** - Automatic orphan handling

#### Offline Data Buffer

- **Message Queue** - Stores messages when offline
- **Auto-send** - Transmits when reconnected
- **Ordering** - Maintains message sequence
- **Reliability** - Ensures no data loss

### 5. Charging Simulation

#### Realistic Behavior

- **Power Ramp-up** - Gradual increase to max power
- **Configurable Duration** - Adjustable ramp time
- **Current Limiting** - Respects configuration limits
- **Dynamic Adjustment** - Real-time power changes

#### Meter Values

**Supported Measurands:**

- `Energy.Active.Import.Register` - Total energy (Wh)
- `Power.Active.Import` - Current power (W)
- `Current.Import` - Current draw (A)
- `Voltage` - Line voltage (V)
- `SoC` - State of Charge (%)
- `Temperature` - Connector temperature (°C)

**Reporting:**

- Configurable interval
- Multiple measurands per message
- Aligned and sample-based
- Transaction begin/end context

### 6. Scenario Simulation

#### Available Scenarios

**Network:**

- Network Offline - Disconnect from OCPP server
- Network Online - Reconnect to server

**User Actions:**

- User Pause (EV) - Simulate EV-side pause
- User Resume (EV) - Resume from EV
- Connector Unlock - Unlock during charging

**Faults:**

- Emergency Stop - Immediate fault stop
- Over Temperature - Temperature fault
- Ground Fault - Ground failure
- Power Outage - Power loss
- Power Restored - Power recovery

#### Scenario Engine

- **Event-based** - Triggers appropriate OCPP messages
- **State Management** - Tracks scenario state
- **Realistic Timing** - Appropriate delays
- **Error Handling** - Proper fault reporting

### 7. Web Interface

#### Dashboard

- **Connection Status** - Real-time OCPP connection
- **Connector Status** - Available/Charging/Faulted
- **Power Output** - Live power display
- **Energy Delivered** - Session energy
- **Duration** - Elapsed time
- **Progress Bar** - Visual power indicator

#### Configuration Panel

- **Search** - Find keys quickly
- **Filter** - By category
- **Edit** - Inline value editing
- **Descriptions** - Detailed help
- **Categories** - Organized view

#### Logs Viewer

- **Real-time** - Live message display
- **Color-coded** - Incoming/outgoing
- **Timestamps** - Precise timing
- **Export** - Download logs
- **Filtering** - Message type filter

#### Charging Controls

- **Start** - Begin charging session
- **Stop** - End session
- **Pause** - Temporary suspend
- **Resume** - Continue charging
- **Manual Consumption** - Add energy manually

### 8. API & WebSocket

#### REST API

**Endpoints:**

- Status & Control
- Configuration Management
- Authorization (planned)
- Transaction History
- Scenario Execution
- Data Transfer

**Features:**

- JSON responses
- Error handling
- CORS support
- Type validation

#### WebSocket

**Real-time Events:**

- `status` - Connection and connector status
- `session` - Charging session updates
- `log` - OCPP message logs
- `event` - System events

**Benefits:**

- Instant updates
- Low latency
- Efficient bandwidth
- Multiple clients

## Performance Characteristics

### Authorization

- **Cache Hit Rate** - ~90% for repeated tags
- **Local List Lookup** - <1ms
- **Central System Query** - Network dependent
- **Concurrent Prevention** - O(1) lookup

### Storage

- **Meter Values** - JSON file per charge point
- **Configuration** - JSON file per charge point
- **Transaction History** - Circular buffer
- **Authorization Cache** - In-memory with TTL

### Network

- **WebSocket** - Persistent connection
- **Heartbeat** - Configurable interval
- **Retry Logic** - Exponential backoff
- **Offline Buffer** - Unlimited queue size

## Security Considerations

### Authorization

- **Multi-level** - Cache, local list, central system
- **Expiry Validation** - Automatic checking
- **Concurrent Prevention** - Transaction safety
- **Offline Protection** - Configurable behavior

### Configuration

- **Read-only Keys** - Protected from changes
- **Validation** - Type and range checking
- **Persistence** - Secure file storage
- **Access Control** - API-level protection

### Data

- **Persistent Storage** - Local file system
- **Transaction Integrity** - Atomic operations
- **Message Ordering** - Sequential processing
- **Error Recovery** - Automatic retry

## Compliance

### OCPP 1.6J

- ✅ **Core Profile** - Full implementation
- ✅ **Smart Charging** - Configuration support
- ✅ **Local Auth List** - Complete implementation
- ✅ **Firmware Management** - Configuration keys
- ✅ **Reservation** - Configuration support

### Standards

- **WebSocket** - RFC 6455
- **JSON** - RFC 8259
- **ISO 8601** - Timestamps
- **UTF-8** - Character encoding

## Extensibility

### Custom Scenarios

- Add new scenarios to `ScenarioEngine`
- Define trigger conditions
- Implement OCPP message sequences
- Register in scenario list

### Custom Measurands

- Extend `MeterValue` generation
- Add to `MeterValuesSampledData`
- Implement calculation logic
- Update UI display

### Custom Configuration

- Add vendor-specific keys
- Define validation rules
- Implement behavior changes
- Update UI categories

### Custom Authorization

- Extend `AuthorizationManager`
- Add custom validation logic
- Implement additional checks
- Integrate with external systems

## Troubleshooting

### Connection Issues

**Symptom:** Cannot connect to OCPP server
**Solutions:**

- Check `OCPP_SERVER_URL` in `.env`
- Verify central system is running
- Check firewall settings
- Review connection logs

### Authorization Failures

**Symptom:** ID tag rejected
**Solutions:**

- Check local authorization list
- Verify tag not expired
- Check central system whitelist
- Review authorization cache

### Configuration Problems

**Symptom:** Configuration changes not applied
**Solutions:**

- Check key is not read-only
- Verify value format
- Review validation rules
- Check configuration file permissions

### Transaction Issues

**Symptom:** Transaction not starting
**Solutions:**

- Verify connector available
- Check authorization status
- Review concurrent transactions
- Check OCPP server response

---

**For more information, see:**

- [README.md](README.md) - Quick start guide
- [Configuration Management](backend/src/models/Configuration.ts) - Configuration keys
- [Authorization System](backend/src/ocpp/AuthorizationManager.ts) - Authorization logic
