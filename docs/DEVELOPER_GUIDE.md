# OCPP Charge Point Simulator - Developer Documentation

## Architecture Overview

The OCPP Charge Point Simulator is built with a TypeScript backend and React frontend, implementing the OCPP 1.6J protocol for electric vehicle charging station simulation.

### Technology Stack

**Backend:**

- Node.js + TypeScript
- Express.js (REST API)
- WebSocket (`ws` library for OCPP communication)
- File-based persistence (JSON)

**Frontend:**

- React + TypeScript
- Vite (build tool)
- WebSocket (real-time updates)
- CSS (custom styling)

### Project Structure

```
ocpp-chargepoint-simulator/
├── backend/
│   ├── src/
│   │   ├── ocpp/
│   │   │   ├── ChargePoint.ts          # Main OCPP client
│   │   │   ├── TransactionManager.ts   # Transaction lifecycle
│   │   │   ├── ConfigurationManager.ts # Configuration persistence
│   │   │   ├── OfflineDataBuffer.ts    # Offline message buffering
│   │   │   └── ScenarioEngine.ts       # Scenario simulation
│   │   ├── models/
│   │   │   ├── Configuration.ts        # Configuration interfaces
│   │   │   └── ChargingSession.ts      # Session data models
│   │   ├── api/
│   │   │   └── routes.ts               # REST API endpoints
│   │   └── server.ts                   # Application entry point
│   ├── data/                            # Persistent data storage
│   └── .env                             # Environment configuration
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── ChargingControls.tsx
│   │   │   ├── ConfigurationPanel.tsx
│   │   │   ├── LogsViewer.tsx
│   │   │   └── ScenarioPanel.tsx
│   │   ├── services/
│   │   │   └── api.ts                  # API client
│   │   ├── App.tsx                     # Main application
│   │   └── index.css                   # Styles
│   └── vite.config.ts
└── docs/                                # Documentation
```

## Core Components

### 1. ChargePoint (Backend)

**File**: `backend/src/ocpp/ChargePoint.ts`

**Responsibilities:**

- WebSocket connection management
- OCPP message handling (CALL, CALLRESULT, CALLERROR)
- BootNotification, Heartbeat, StatusNotification
- Authorization requests
- Configuration management integration

**Key Methods:**

```typescript
class ChargePoint extends EventEmitter {
    // Connection
    public async connect(): Promise<void>
    public disconnect(): void
    public isConnectedToServer(): boolean
    
    // OCPP Messages
    public async sendBootNotification(): Promise<any>
    public async sendHeartbeat(): Promise<any>
    public async sendAuthorize(idTag: string): Promise<any>
    public async sendStatusNotification(connectorId: number, status: ConnectorStatus): Promise<void>
    public async sendStartTransaction(connectorId: number, idTag: string, meterStart: number): Promise<any>
    public async sendStopTransaction(transactionId: number, meterStop: number, idTag: string, reason: string): Promise<any>
    public async sendMeterValues(connectorId: number, transactionId: number, meterValue: MeterValue[]): Promise<void>
    
    // Configuration
    public getConfiguration(): OCPPConfiguration[]
    public getConfigurationManager(): ConfigurationManager
    
    // Internal
    private handleRequest(messageId: string, action: string, payload: any): void
    private handleGetConfiguration(payload: any): any
    private handleChangeConfiguration(payload: any): any
    private handleConfigurationChange(key: string, newValue: string): void
}
```

**Event System:**

```typescript
// Emitted events
chargePoint.emit('connected');
chargePoint.emit('disconnected');
chargePoint.emit('message', { direction: 'incoming'|'outgoing', data: any });
chargePoint.emit('meterValueIntervalChanged', intervalSeconds: number);

// Listened events (from ConfigurationManager)
configManager.on('configurationChanged', ({ key, newValue }) => {
    this.handleConfigurationChange(key, newValue);
});
```

### 2. TransactionManager (Backend)

**File**: `backend/src/ocpp/TransactionManager.ts`

**Responsibilities:**

- Charging session lifecycle management
- Transaction ID generation (unique per session)
- Meter value reporting
- Charging simulation (power ramp-up, energy calculation)
- Configuration-driven behavior

**Key Methods:**

```typescript
class TransactionManager extends EventEmitter {
    // Transaction Control
    public async startTransaction(connectorId: number, idTag: string): Promise<ChargingSession>
    public async stopTransaction(connectorId: number, reason: string): Promise<void>
    public async pauseTransaction(connectorId: number): Promise<void>
    public async resumeTransaction(connectorId: number): Promise<void>
    
    // Session Management
    public getSession(connectorId: number): ChargingSession | undefined
    public getAllSessions(): ChargingSession[]
    public hasActiveSession(connectorId: number): boolean
    
    // Internal
    private generateUniqueTransactionId(): number
    private startChargingSimulation(connectorId: number): void
    private stopChargingSimulation(connectorId: number): void
    private startMeterValueReporting(connectorId: number): void
    private stopMeterValueReporting(connectorId: number): void
    private async sendMeterValues(connectorId: number, session: ChargingSession, context: ReadingContext): Promise<void>
    private calculateCurrent(powerKw: number): number
}
```

**Transaction ID Generation:**

```typescript
private generateUniqueTransactionId(): number {
    const timestamp = Date.now(); // Milliseconds since epoch
    const random = Math.floor(Math.random() * 1000); // 0-999
    return timestamp * 1000 + random;
}
```

**Charging Simulation:**

```typescript
// Power ramp-up over 5 seconds
if (elapsedSeconds <= rampUpDuration) {
    session.powerKw = (this.maxPowerKw / rampUpDuration) * elapsedSeconds;
} else {
    session.powerKw = this.maxPowerKw;
}

// Energy calculation (kWh = kW * hours)
session.energyKwh += (session.powerKw / 3600); // per second
session.currentMeterValue = Math.round(session.energyKwh * 1000); // Wh
```

### 3. ConfigurationManager (Backend)

**File**: `backend/src/ocpp/ConfigurationManager.ts`

**Responsibilities:**

- Configuration persistence (file-based)
- Configuration validation
- Change notification via events
- Default configuration management

**Key Methods:**

```typescript
class ConfigurationManager extends EventEmitter {
    // Configuration Access
    public getAllConfiguration(): OCPPConfiguration[]
    public getValue(key: string): string | undefined
    public getValueAsNumber(key: string, defaultValue: number): number
    public getValueAsBoolean(key: string, defaultValue: boolean): boolean
    
    // Configuration Modification
    public changeConfiguration(key: string, value: string): 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported'
    
    // Persistence
    private loadConfiguration(): void
    private saveConfiguration(): void
    private mergeWithDefaults(saved: OCPPConfiguration[]): OCPPConfiguration[]
}
```

**File Format** (`data/config_{chargePointId}.json`):

```json
[
  {
    "key": "HeartbeatInterval",
    "readonly": false,
    "value": "60"
  },
  {
    "key": "MeterValueSampleInterval",
    "readonly": false,
    "value": "30"
  }
]
```

### 4. OfflineDataBuffer (Backend)

**File**: `backend/src/ocpp/OfflineDataBuffer.ts`

**Responsibilities:**

- Buffer OCPP messages when offline
- File-based persistence
- Message retry tracking
- Buffer statistics

**Key Methods:**

```typescript
class OfflineDataBuffer extends EventEmitter {
    // Buffer Management
    public addMessage(type: BufferedMessage['type'], payload: any, connectorId?: number, transactionId?: number): void
    public getMessages(): BufferedMessage[]
    public getMessageCount(): number
    public removeMessage(messageId: string): void
    public incrementRetry(messageId: string): void
    public clearBuffer(): void
    public isEmpty(): boolean
    
    // Statistics
    public getStats(): {
        totalMessages: number;
        byType: Record<string, number>;
        oldestMessage: Date | null;
        newestMessage: Date | null;
    }
}
```

**Message Format:**

```typescript
interface BufferedMessage {
    id: string;                    // Unique buffer entry ID
    type: 'StartTransaction' | 'StopTransaction' | 'MeterValues' | 'StatusNotification';
    timestamp: Date;               // When message was created
    payload: any;                  // OCPP message payload
    retries: number;               // Number of send attempts
    connectorId?: number;
    transactionId?: number;
}
```

## OCPP Protocol Implementation

### Message Format

OCPP 1.6J uses JSON-RPC 2.0 over WebSocket:

```typescript
// CALL (request from charge point)
[2, "unique-id", "Action", { ...payload }]

// CALLRESULT (response from server)
[3, "unique-id", { ...result }]

// CALLERROR (error response)
[4, "unique-id", "ErrorCode", "ErrorDescription", { ...details }]
```

### Implemented Messages

**Charge Point → Server:**

- `BootNotification` - Initial connection
- `Heartbeat` - Keep-alive
- `StatusNotification` - Connector status changes
- `Authorize` - RFID authorization
- `StartTransaction` - Begin charging
- `StopTransaction` - End charging
- `MeterValues` - Energy consumption data
- `DataTransfer` - Custom vendor data

**Server → Charge Point:**

- `GetConfiguration` - Retrieve configuration
- `ChangeConfiguration` - Update configuration
- `RemoteStartTransaction` - Server-initiated start
- `RemoteStopTransaction` - Server-initiated stop
- `Reset` - Reboot charge point
- `UnlockConnector` - Unlock cable
- `DataTransfer` - Custom vendor data

### Configuration-Driven Behavior

The simulator applies configuration changes dynamically:

```typescript
private handleConfigurationChange(key: string, newValue: string): void {
    switch (key) {
        case 'HeartbeatInterval':
            if (this.isConnected) {
                this.startHeartbeat(); // Restart with new interval
            }
            break;
        case 'MeterValueSampleInterval':
            const intervalSeconds = parseInt(newValue);
            this.emit('meterValueIntervalChanged', intervalSeconds);
            break;
    }
}
```

**TransactionManager listens and applies:**

```typescript
this.chargePoint.on('meterValueIntervalChanged', (newInterval: number) => {
    this.meterValueIntervalSeconds = newInterval;
    
    // Restart meter value reporting for active sessions
    this.sessions.forEach((session, connectorId) => {
        if (session.status === SessionStatus.Charging) {
            this.stopMeterValueReporting(connectorId);
            this.startMeterValueReporting(connectorId);
        }
    });
});
```

## Data Models

### ChargingSession

```typescript
interface ChargingSession {
    connectorId: number;
    idTag: string;
    transactionId?: number;
    startTime: Date;
    startMeterValue: number;
    currentMeterValue: number;
    status: SessionStatus;
    powerKw: number;
    energyKwh: number;
    duration: number;
}

enum SessionStatus {
    Preparing = 'Preparing',
    Charging = 'Charging',
    Paused = 'Paused',
    Finishing = 'Finishing',
    Completed = 'Completed'
}
```

### MeterValue

```typescript
interface MeterValue {
    timestamp: string; // ISO 8601
    sampledValue: SampledValue[];
}

interface SampledValue {
    value: string;
    context?: ReadingContext;
    format?: ValueFormat;
    measurand?: Measurand;
    phase?: Phase;
    location?: Location;
    unit?: UnitOfMeasure;
}

enum Measurand {
    EnergyActiveImportRegister = 'Energy.Active.Import.Register',
    PowerActiveImport = 'Power.Active.Import',
    CurrentImport = 'Current.Import',
    Voltage = 'Voltage',
    Temperature = 'Temperature',
    SoC = 'SoC',
    Frequency = 'Frequency'
}
```

### OCPPConfiguration

```typescript
interface OCPPConfiguration {
    key: string;
    readonly: boolean;
    value?: string;
}
```

## API Endpoints

### REST API

**Base URL**: `http://localhost:3001/api`

```typescript
// Connection
POST /connect
POST /disconnect

// Charging Control
POST /start-charging
  Body: { connectorId: number, idTag: string }
POST /stop-charging
  Body: { connectorId: number }
POST /pause-charging
  Body: { connectorId: number }
POST /resume-charging
  Body: { connectorId: number }

// Configuration
GET /config
POST /config
  Body: { key: string, value: string }

// Status
GET /status

// Scenarios
POST /scenario
  Body: { type: string }

// OCPP Messages
POST /heartbeat
POST /status-notification
  Body: { connectorId: number, status: string }
POST /data-transfer
  Body: { vendorId: string, messageId?: string, data?: string }
```

### WebSocket API

**URL**: `ws://localhost:3001`

**Messages from server:**

```typescript
{
    type: 'log',
    data: { timestamp: Date, direction: 'incoming'|'outgoing', data: any }
}

{
    type: 'logs',
    data: LogEntry[]
}

{
    type: 'session',
    data: ChargingSession
}

{
    type: 'status',
    data: { connected: boolean, sessions: ChargingSession[] }
}

{
    type: 'event',
    event: 'connected'|'disconnected'|'transactionStarted'|'transactionStopped'|...,
    data: any
}
```

## Development Workflow

### Adding a New OCPP Message

1. **Define the interface** in `models/`:

```typescript
interface NewMessageRequest {
    field1: string;
    field2: number;
}
```

2. **Add sender method** to `ChargePoint.ts`:

```typescript
public async sendNewMessage(param: string): Promise<any> {
    const payload: NewMessageRequest = {
        field1: param,
        field2: 123
    };
    return this.sendCall('NewMessage', payload);
}
```

3. **Add handler** if server can initiate:

```typescript
private handleNewMessage(payload: any): any {
    // Process the message
    return { status: 'Accepted' };
}

// Add to handleRequest switch:
case 'NewMessage':
    return this.handleNewMessage(payload);
```

4. **Add API endpoint** in `routes.ts`:

```typescript
router.post('/new-message', async (req, res) => {
    try {
        const result = await chargePoint.sendNewMessage(req.body.param);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
```

### Adding a New Configuration Key

1. **Add to default configuration** in `Configuration.ts`:

```typescript
export const defaultOCPPConfiguration: OCPPConfiguration[] = [
    // ... existing keys
    {
        key: 'NewConfigKey',
        readonly: false,
        value: 'default-value'
    }
];
```

2. **Add metadata** in `ConfigurationPanel.tsx`:

```typescript
const configMetadata: Record<string, ConfigMetadata> = {
    // ... existing metadata
    'NewConfigKey': {
        category: 'Category Name',
        description: 'Detailed description of what this key does',
        type: 'string',
        options: ['option1', 'option2'] // if applicable
    }
};
```

3. **Apply behavior** in `ChargePoint.ts` or `TransactionManager.ts`:

```typescript
private handleConfigurationChange(key: string, newValue: string): void {
    switch (key) {
        // ... existing cases
        case 'NewConfigKey':
            // Apply the configuration change
            this.applyNewConfig(newValue);
            break;
    }
}
```

## Testing

### Unit Testing (Future)

```typescript
// Example test structure
describe('TransactionManager', () => {
    it('should generate unique transaction IDs', () => {
        const ids = new Set();
        for (let i = 0; i < 1000; i++) {
            const id = transactionManager.generateUniqueTransactionId();
            expect(ids.has(id)).toBe(false);
            ids.add(id);
        }
    });
});
```

### Integration Testing

```bash
# Test OCPP connection
curl -X POST http://localhost:3001/api/connect

# Start charging
curl -X POST http://localhost:3001/api/start-charging \
  -H "Content-Type: application/json" \
  -d '{"connectorId": 1, "idTag": "TEST_TAG"}'

# Update configuration
curl -X POST http://localhost:3001/api/config \
  -H "Content-Type: application/json" \
  -d '{"key": "MeterValueSampleInterval", "value": "5"}'

# Check status
curl http://localhost:3001/api/status
```

## Performance Considerations

### Memory Management

- **Session cleanup**: Sessions are removed from Map on completion
- **Interval cleanup**: All setInterval timers cleared on session end
- **Buffer limits**: Consider implementing max buffer size for offline data

### WebSocket Optimization

- **Message batching**: Consider batching meter values
- **Compression**: Enable WebSocket compression for large payloads
- **Reconnection**: Exponential backoff on connection failures

### File I/O

- **Async operations**: Use async file operations to avoid blocking
- **Write batching**: Batch configuration writes to reduce I/O
- **Error handling**: Graceful degradation if file writes fail

## Security Considerations

### Production Deployment

1. **Use WSS**: Always use encrypted WebSocket (`wss://`)
2. **Authentication**: Implement proper authentication for API endpoints
3. **Input Validation**: Validate all user inputs and OCPP messages
4. **Rate Limiting**: Implement rate limiting on API endpoints
5. **CORS**: Configure CORS properly for frontend access
6. **Environment Variables**: Never commit `.env` file to version control

### OCPP Security

1. **Certificate Validation**: Validate server certificates
2. **Message Signing**: Consider implementing message signing
3. **Authorization**: Validate RFID tags against whitelist
4. **Audit Logging**: Log all OCPP messages for audit trail

## Troubleshooting

### Common Issues

**WebSocket Connection Fails:**

- Check URL format (no trailing slash)
- Verify server is running
- Check firewall rules
- Enable debug logging

**Configuration Not Persisting:**

- Check file permissions on `data/` directory
- Verify disk space available
- Check for JSON syntax errors in config file

**Memory Leaks:**

- Ensure all intervals are cleared
- Check for event listener leaks
- Monitor session cleanup

### Debug Logging

Enable verbose logging:

```typescript
// In ChargePoint.ts
console.log('[ChargePoint] Debug:', message);

// In TransactionManager.ts
console.log('[TransactionManager] Debug:', message);
```

## Contributing

### Code Style

- Use TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public methods
- Use meaningful variable names
- Keep functions focused and small

### Pull Request Process

1. Create feature branch
2. Implement changes with tests
3. Update documentation
4. Submit PR with description
5. Address review comments

## Future Enhancements

- [ ] Complete offline data buffering
- [ ] Implement smart charging profiles
- [ ] Add firmware update support
- [ ] Implement diagnostics
- [ ] Add local authorization list
- [ ] Support OCPP 2.0.1
- [ ] Add unit tests
- [ ] Implement CI/CD pipeline
- [ ] Add Docker support
- [ ] Create admin dashboard
