# Eveys Charge Point Simulator - How It Works

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [OCPP Communication](#ocpp-communication)
6. [Authorization Flow](#authorization-flow)
7. [Transaction Lifecycle](#transaction-lifecycle)
8. [Configuration Management](#configuration-management)
9. [Persistence Layer](#persistence-layer)
10. [Real-time Updates](#real-time-updates)

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Eveys CPS System Architecture                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────┐                    ┌────────────────┐       │
│  │   Web Browser  │◄──────────────────►│  OCPP Central  │       │
│  │   (Frontend)   │    WebSocket       │     System     │       │
│  └────────┬───────┘                    └────────▲───────┘       │
│           │                                      │               │
│           │ HTTP/WebSocket                      │ WebSocket     │
│           │                                      │ (OCPP 1.6J)   │
│           ▼                                      │               │
│  ┌────────────────┐                    ┌────────┴───────┐       │
│  │   Frontend     │                    │   ChargePoint  │       │
│  │   React App    │                    │   OCPP Client  │       │
│  └────────────────┘                    └────────────────┘       │
│                                                  │               │
│           ▲                                      │               │
│           │                                      ▼               │
│  ┌────────┴───────────────────────────────────────────────┐    │
│  │              Backend (Node.js + TypeScript)             │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │ Transaction  │  │Authorization │  │Configuration │  │    │
│  │  │   Manager    │  │   Manager    │  │   Manager    │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │   Scenario   │  │ Meter Value  │  │  Transaction │  │    │
│  │  │    Engine    │  │   Storage    │  │   History    │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                  │                               │
│                                  ▼                               │
│                        ┌──────────────────┐                      │
│                        │  Persistent Data │                      │
│                        │  (JSON Files)    │                      │
│                        └──────────────────┘                      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**

- **React 18** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **Lucide React** - Icon library
- **Recharts** - Charting library

**Backend:**

- **Node.js 18+** - JavaScript runtime
- **TypeScript** - Type-safe development
- **Express** - Web server framework
- **ws** - WebSocket library
- **tsx** - TypeScript execution with hot reload

**Protocol:**

- **OCPP 1.6J** - Open Charge Point Protocol
- **WebSocket** - Real-time bidirectional communication
- **JSON** - Data serialization format

**Storage:**

- **JSON Files** - Persistent data storage
- **File System** - Configuration, meter values, transactions

## Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Presentation Layer                     │
│  (React Components, UI, User Interactions)              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   API Layer                              │
│  (REST Endpoints, WebSocket Server, Request Handling)   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   Business Logic Layer                   │
│  (Managers, Engines, Core Functionality)                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   OCPP Protocol Layer                    │
│  (ChargePoint, Message Handling, Protocol Logic)        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   Persistence Layer                      │
│  (File Storage, Data Serialization, State Management)   │
└─────────────────────────────────────────────────────────┘
```

### Component Interaction

```
User Action (Frontend)
    │
    ▼
API Request (HTTP/WebSocket)
    │
    ▼
Route Handler (Express)
    │
    ▼
Business Logic (Manager)
    │
    ├──► Authorization Check
    │    (AuthorizationManager)
    │
    ├──► Configuration Lookup
    │    (ConfigurationManager)
    │
    └──► OCPP Message
         (ChargePoint)
              │
              ▼
         WebSocket Send
              │
              ▼
         Central System
```

## Core Components

### 1. ChargePoint (OCPP Client)

**Purpose:** Manages WebSocket connection and OCPP protocol communication

**Responsibilities:**

- Establish and maintain WebSocket connection
- Send OCPP messages (Call, CallResult, CallError)
- Receive and route incoming messages
- Handle connection lifecycle
- Emit events for state changes

**Key Methods:**

```typescript
connect() - Establish WebSocket connection
disconnect() - Close connection gracefully
sendCall(action, payload) - Send OCPP Call message
sendBootNotification() - Register with central system
sendHeartbeat() - Send keep-alive
sendStartTransaction() - Begin charging session
sendStopTransaction() - End charging session
sendMeterValues() - Report energy consumption
sendAuthorize() - Validate ID tag
```

**Events:**

```typescript
'connected' - Connection established
'disconnected' - Connection closed
'message' - OCPP message received/sent
'error' - Error occurred
'remoteStartTransaction' - Remote start requested
```

### 2. TransactionManager

**Purpose:** Manages charging sessions and transactions

**Responsibilities:**

- Create and track charging sessions
- Generate unique transaction IDs
- Manage session lifecycle
- Control charging simulation
- Report meter values
- Handle pause/resume
- Integrate with authorization

**Key Methods:**

```typescript
startTransaction(connectorId, idTag, isRemoteStart)
stopTransaction(connectorId, reason)
pauseTransaction(connectorId)
resumeTransaction(connectorId)
getAllSessions()
getSession(connectorId)
```

**Session State Machine:**

```
Available
    │
    ▼ startTransaction()
Preparing
    │
    ▼ Authorization Success
Charging
    │
    ├──► pauseTransaction() ──► SuspendedEV ──► resumeTransaction() ──┐
    │                                                                   │
    └──────────────────────────────────────────────────────────────────┘
    │
    ▼ stopTransaction()
Finishing
    │
    ▼
Completed
```

### 3. AuthorizationManager

**Purpose:** Orchestrates ID tag authorization with multi-level checking

**Responsibilities:**

- Check authorization cache
- Query local authorization list
- Send Authorize to central system
- Handle offline behavior
- Prevent concurrent transactions
- Validate tag expiry
- Track active transactions

**Authorization Flow:**

```
authorize(idTag)
    │
    ▼
Check Cache
    │
    ├──► Hit ──► Return Cached Result
    │
    └──► Miss
         │
         ▼
    Check Local List
         │
         ├──► Found ──► Check Expiry ──► Return Result
         │
         └──► Not Found
              │
              ▼
         Query Central System
              │
              ├──► Connected ──► Send Authorize ──► Cache Result ──► Return
              │
              └──► Offline ──► Check AllowOfflineTxForUnknownId
                                    │
                                    ├──► true ──► Accept
                                    └──► false ──► Reject
```

### 4. ConfigurationManager

**Purpose:** Manages OCPP configuration keys

**Responsibilities:**

- Load configuration from file
- Save configuration changes
- Validate configuration values
- Apply configuration updates
- Emit change events
- Provide configuration access

**Key Methods:**

```typescript
getValue(key, defaultValue)
getValueAsNumber(key, defaultValue)
getValueAsBoolean(key, defaultValue)
changeConfiguration(key, value)
getAllConfiguration()
```

**Configuration Categories:**

- Core (timing, intervals)
- Authorization (local list, cache)
- Transaction (retries, behavior)
- Meter Values (measurands, intervals)
- Smart Charging (profiles, schedules)
- Security (authentication)
- Vendor Specific (custom)

### 5. LocalAuthList

**Purpose:** Maintains persistent whitelist of authorized ID tags

**Responsibilities:**

- Store authorized tags
- Support tag expiry
- Support parent ID tags
- Version tracking
- Persistence to file
- Default tag initialization

**Data Structure:**

```typescript
{
  version: number,
  tags: [
    {
      idTag: string,
      expiryDate?: string,
      parentIdTag?: string
    }
  ]
}
```

### 6. AuthorizationCache

**Purpose:** Cache authorization responses for performance

**Responsibilities:**

- Store recent authorizations
- TTL-based expiration
- LRU eviction
- Statistics tracking
- Automatic cleanup

**Cache Entry:**

```typescript
{
  idTag: string,
  status: 'Accepted' | 'Blocked' | 'Expired' | 'Invalid',
  expiryDate?: string,
  parentIdTag?: string,
  timestamp: number,
  ttl: number
}
```

### 7. MeterValueStorage

**Purpose:** Persist meter values across restarts

**Responsibilities:**

- Store current meter values per connector
- Load values on startup
- Update values during charging
- Ensure continuity

### 8. TransactionHistory

**Purpose:** Record historical transaction data

**Responsibilities:**

- Log transaction starts
- Record transaction completions
- Calculate statistics
- Provide history access

### 9. ScenarioEngine

**Purpose:** Simulate various charging scenarios

**Responsibilities:**

- Execute predefined scenarios
- Trigger appropriate OCPP messages
- Manage scenario state
- Emit scenario events

## Data Flow

### Starting a Charging Session

```
1. User enters ID tag and clicks "Start Charging"
   │
   ▼
2. Frontend sends POST /api/start-charging
   │
   ▼
3. API route calls TransactionManager.startTransaction()
   │
   ▼
4. TransactionManager checks connection status
   │
   ▼
5. TransactionManager calls AuthorizationManager.authorize()
   │
   ▼
6. AuthorizationManager performs multi-level check:
   ├─► Check cache (fast)
   ├─► Check local list (offline capable)
   └─► Query central system (authoritative)
   │
   ▼
7. If authorized, TransactionManager:
   ├─► Generates unique transaction ID
   ├─► Creates session object
   ├─► Sends StatusNotification (Preparing)
   └─► Sends StartTransaction to central system
   │
   ▼
8. Central system responds with transaction ID
   │
   ▼
9. TransactionManager:
   ├─► Registers transaction in tracker
   ├─► Registers with AuthorizationManager
   ├─► Records in history
   ├─► Updates status to Charging
   ├─► Starts charging simulation
   └─► Starts meter value reporting
   │
   ▼
10. Frontend receives real-time updates via WebSocket
    │
    ▼
11. Dashboard displays:
    ├─► Power output (ramping up)
    ├─► Energy delivered (accumulating)
    ├─► Duration (counting)
    └─► Transaction ID
```

### Meter Value Reporting

```
1. Charging simulation updates meter values
   │
   ▼
2. MeterValueStorage persists values to disk
   │
   ▼
3. Timer triggers (based on MeterValueSampleInterval)
   │
   ▼
4. TransactionManager.sendMeterValues()
   │
   ▼
5. Reads current values from MeterValueStorage
   │
   ▼
6. Builds MeterValues message with configured measurands:
   ├─► Energy.Active.Import.Register
   ├─► Power.Active.Import
   ├─► Current.Import
   ├─► Voltage
   ├─► SoC
   └─► Temperature
   │
   ▼
7. ChargePoint sends MeterValues to central system
   │
   ▼
8. WebSocket broadcasts to frontend
   │
   ▼
9. Dashboard updates in real-time
```

### Configuration Change

```
1. User edits configuration key in UI
   │
   ▼
2. Frontend sends POST /api/config
   │
   ▼
3. ConfigurationManager.changeConfiguration(key, value)
   │
   ▼
4. Validates value format and constraints
   │
   ▼
5. Saves to configuration file
   │
   ▼
6. Emits 'configurationChanged' event
   │
   ▼
7. Listeners apply changes:
   ├─► ChargePoint updates heartbeat interval
   ├─► TransactionManager updates meter interval
   └─► Other components react as needed
   │
   ▼
8. Frontend receives confirmation
   │
   ▼
9. UI updates to show new value
```

## OCPP Communication

### Message Types

**Call (Request):**

```json
[
  2,
  "unique-message-id",
  "ActionName",
  {
    "payload": "data"
  }
]
```

**CallResult (Response):**

```json
[
  3,
  "unique-message-id",
  {
    "result": "data"
  }
]
```

**CallError (Error):**

```json
[
  4,
  "unique-message-id",
  "ErrorCode",
  "Error description",
  {}
]
```

### Message Flow Example: StartTransaction

**Charge Point → Central System:**

```json
[
  2,
  "msg-12345",
  "StartTransaction",
  {
    "connectorId": 1,
    "idTag": "TEST-TAG-001",
    "meterStart": 0,
    "timestamp": "2025-12-10T10:00:00.000Z"
  }
]
```

**Central System → Charge Point:**

```json
[
  3,
  "msg-12345",
  {
    "transactionId": 42,
    "idTagInfo": {
      "status": "Accepted"
    }
  }
]
```

## Authorization Flow

### Detailed Authorization Process

```
┌─────────────────────────────────────────────────────────┐
│              Authorization Decision Tree                 │
└─────────────────────────────────────────────────────────┘

authorize(idTag)
    │
    ▼
┌───────────────┐
│ Check Cache   │
└───────┬───────┘
        │
        ├──► Cache Hit ──► Check TTL
        │                      │
        │                      ├──► Valid ──► Return Cached
        │                      └──► Expired ──► Continue
        │
        └──► Cache Miss
                │
                ▼
        ┌───────────────┐
        │ Check Local   │
        │ Auth List     │
        └───────┬───────┘
                │
                ├──► Found
                │      │
                │      ├──► Check Expiry
                │      │        │
                │      │        ├──► Valid ──► Cache ──► Return Accepted
                │      │        └──► Expired ──► Return Expired
                │      │
                │      └──► Check Concurrent
                │               │
                │               ├──► Has Active ──► Return Blocked
                │               └──► No Active ──► Continue
                │
                └──► Not Found
                       │
                       ▼
               ┌───────────────┐
               │ Check         │
               │ Connection    │
               └───────┬───────┘
                       │
                       ├──► Connected
                       │      │
                       │      ▼
                       │  Send Authorize
                       │      │
                       │      ▼
                       │  Receive Response
                       │      │
                       │      ├──► Cache Result
                       │      └──► Return Status
                       │
                       └──► Offline
                              │
                              ▼
                      Check AllowOfflineTxForUnknownId
                              │
                              ├──► true ──► Return Accepted
                              └──► false ──► Return Invalid
```

## Transaction Lifecycle

### Complete Transaction Flow

```
1. IDLE STATE
   - Connector: Available
   - No active session
   │
   ▼
2. AUTHORIZATION
   - User provides ID tag
   - Authorization flow executes
   - Result: Accepted/Rejected
   │
   ▼ (if Accepted)
3. PREPARING
   - StatusNotification (Preparing)
   - Generate transaction ID
   - Create session object
   │
   ▼
4. START TRANSACTION
   - Send StartTransaction to CS
   - Wait for response
   - Receive transaction ID
   │
   ▼
5. CHARGING
   - StatusNotification (Charging)
   - Start power simulation
   - Start meter value reporting
   - Register in tracker
   - Register with auth manager
   - Record in history
   │
   ▼ (during charging)
6. METER VALUE REPORTING
   - Periodic MeterValues messages
   - Real-time dashboard updates
   - Persistent storage
   │
   ▼ (user stops or remote stop)
7. FINISHING
   - Stop power simulation
   - Stop meter reporting
   - StatusNotification (Finishing)
   - Send final MeterValues
   │
   ▼
8. STOP TRANSACTION
   - Send StopTransaction to CS
   - Include final meter value
   - Include stop reason
   │
   ▼
9. CLEANUP
   - Unregister from tracker
   - Unregister from auth manager
   - Complete in history
   - Remove session
   - StatusNotification (Available)
   │
   ▼
10. IDLE STATE
    - Ready for next transaction
```

## Configuration Management

### Configuration Lifecycle

```
1. INITIALIZATION
   - Load from file (if exists)
   - Merge with defaults
   - Validate values
   │
   ▼
2. RUNTIME ACCESS
   - Components query values
   - Type-safe getters
   - Default value fallback
   │
   ▼
3. CHANGE REQUEST
   - Validate new value
   - Check if read-only
   - Apply constraints
   │
   ▼
4. PERSISTENCE
   - Save to file
   - Atomic write
   - Error handling
   │
   ▼
5. EVENT EMISSION
   - Notify listeners
   - Apply changes
   - Update behavior
```

## Persistence Layer

### Data Storage Structure

```
backend/data/
├── config_{chargePointId}.json          # OCPP configuration
├── local_auth_list_{chargePointId}.json # Authorized ID tags
├── meter_values_{chargePointId}.json    # Current meter values
├── transaction_tracker_{chargePointId}.json # Active transactions
└── transaction_history_{chargePointId}.json # Historical data
```

### File Operations

**Read:**

1. Check file exists
2. Read file content
3. Parse JSON
4. Validate structure
5. Return data or defaults

**Write:**

1. Serialize to JSON
2. Write to temp file
3. Atomic rename
4. Error handling
5. Logging

## Real-time Updates

### WebSocket Communication

**Backend → Frontend:**

```typescript
// Status updates
{
  type: 'status',
  data: {
    connected: boolean,
    sessions: Session[],
    timestamp: Date
  }
}

// Session updates
{
  type: 'session',
  data: Session
}

// OCPP message logs
{
  type: 'log',
  data: {
    timestamp: Date,
    direction: 'incoming' | 'outgoing',
    data: any
  }
}

// Events
{
  type: 'event',
  event: 'connected' | 'disconnected' | 'transactionStarted' | ...,
  data: any
}
```

### Update Flow

```
1. State Change (Backend)
   │
   ▼
2. Event Emission
   │
   ▼
3. WebSocket Server Broadcast
   │
   ▼
4. Frontend Receives Message
   │
   ▼
5. State Update (React)
   │
   ▼
6. UI Re-render
```

## Summary

Eveys CPS employs a well-architected, modular design that:

- **Separates Concerns** - Clear component boundaries
- **Enables Testing** - Modular, testable components
- **Supports Extension** - Easy to add features
- **Ensures Reliability** - Persistent state, error handling
- **Provides Performance** - Caching, efficient storage
- **Maintains Compliance** - Full OCPP 1.6J implementation

The architecture balances simplicity with functionality, making it both powerful for advanced use cases and accessible for basic testing needs.

---

*Eveys - Powering the future of electric mobility*
