import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { ChargePoint } from './ocpp/ChargePoint';
import { TransactionManager } from './ocpp/TransactionManager';
import { AuthorizationManager } from './ocpp/AuthorizationManager';
import { ScenarioEngine } from './simulation/ScenarioEngine';
import { createApiRoutes } from './api/routes';
import { WebSocketServer } from './api/websocket';
import { ChargePointConfiguration, ConnectorStatus } from './models/Configuration';
import { logger, LogEntry } from './utils/logger';

// Load environment variables
dotenv.config();

const PORT = process.env.API_PORT || 3001;

// Stamp every log entry with the cp_id so frontend filters and grep
// over multiple sims line up. Set min level from env so devs can flip
// to debug without a code change.
logger.setCpId(process.env.CHARGE_POINT_ID || 'CP001');
const envLevel = (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
logger.setMinLevel(envLevel);

// Create charge point configuration
const config: ChargePointConfiguration = {
    chargePointId: process.env.CHARGE_POINT_ID || 'CP001',
    ocppServerUrl: process.env.OCPP_SERVER_URL || 'ws://localhost:8180/steve/websocket/CentralSystemService',
    maxPowerKw: parseFloat(process.env.MAX_POWER_KW || '22'),
    connectorType: 'Type2',
    voltage: parseInt(process.env.VOLTAGE || '400'),
    maxCurrent: parseInt(process.env.MAX_CURRENT || '32'),
    numberOfConnectors: parseInt(process.env.NUMBER_OF_CONNECTORS || '2'),
    meterValueInterval: parseInt(process.env.METER_VALUE_INTERVAL || '60'),
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '300')
};


// Initialize OCPP components
const chargePoint = new ChargePoint(config);
const configManager = chargePoint.getConfigurationManager();
const transactionManager = new TransactionManager(chargePoint, configManager, config.chargePointId, config.maxPowerKw, config.meterValueInterval);

// Initialize Authorization Manager
const authorizationManager = new AuthorizationManager(chargePoint, configManager, config.chargePointId);
chargePoint.setAuthorizationManager(authorizationManager);
transactionManager.setAuthorizationManager(authorizationManager);

const scenarioEngine = new ScenarioEngine(chargePoint, transactionManager);

// Connect to OCPP server. Don't crash on initial-connect failures
// (CALLERROR from CSMS, network glitch) — `ChargePoint.scheduleReconnect`
// already retries every 5 s, so we just log and let it heal.
chargePoint.connect().catch((err: Error) => {
    console.error('[Server] Initial connect failed; reconnect loop will retry:', err.message);
});

// Last-line-of-defense: any other unhandled promise rejection (e.g. a CALLERROR
// for a request whose caller forgot a .catch) should log, not exit(1). The
// process stays up so the WebSocket reconnect loop can recover.
process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    console.error('[Server] Unhandled promise rejection:', msg);
});


// Create Express app
const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);

// Stream every structured log entry to connected UI clients. Subscribed
// here (after wsServer exists) rather than inside the logger module so
// the logger stays a leaf with no coupling to the websocket plumbing.
logger.on('entry', (entry: LogEntry) => {
    wsServer.broadcastTrace(entry);
});

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// API routes
app.use('/api', createApiRoutes(chargePoint, transactionManager, scenarioEngine));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Event listeners for real-time updates
chargePoint.on('connected', () => {
    wsServer.broadcastEvent('connected', { timestamp: new Date() });
});

chargePoint.on('disconnected', () => {
    wsServer.broadcastEvent('disconnected', { timestamp: new Date() });
});

// Handle boot completed - check for active sessions and orphaned transactions
chargePoint.on('bootCompleted', async () => {
    console.log('[Server] Boot completed, checking for active sessions and orphaned transactions');

    // Check for active sessions from TransactionManager
    const activeSessions = transactionManager.getAllSessions();
    if (activeSessions.length > 0) {
        console.log(`[Server] Found ${activeSessions.length} active session(s), notifying server`);
        for (const session of activeSessions) {
            // Update connector status to reflect active session
            const connectorStatus = session.status === 'Charging' ? ConnectorStatus.Charging : ConnectorStatus.Preparing;
            await chargePoint.sendStatusNotification(session.connectorId, connectorStatus);
            console.log(`[Server] Sent status notification for connector ${session.connectorId}: ${connectorStatus}`);
        }
    }

    // Check for orphaned transactions that need to be stopped
    const orphanedTransactions = transactionManager.getOrphanedTransactions();
    if (orphanedTransactions.length > 0) {
        console.log(`[Server] Found ${orphanedTransactions.length} orphaned transaction(s)`);
        // These are transactions that were started but the device lost connection
        // They should be stopped on reconnection
        for (const txn of orphanedTransactions) {
            console.log(`[Server] Orphaned transaction found: ${JSON.stringify(txn)}`);
            // Optionally stop them automatically or log for manual intervention
        }
    }
});

chargePoint.on('error', (error: Error) => {
    console.error('[Server] ChargePoint error:', error.message);
    wsServer.broadcastEvent('error', {
        message: error.message,
        timestamp: new Date()
    });
});

chargePoint.on('message', (message: any) => {
    wsServer.broadcastLog({
        timestamp: new Date(),
        direction: message.direction,
        data: message.data
    });
});

transactionManager.on('transactionStarted', (session) => {
    wsServer.broadcastEvent('transactionStarted', session);
});

transactionManager.on('transactionStopped', (session) => {
    wsServer.broadcastEvent('transactionStopped', session);
});

transactionManager.on('transactionPaused', (session) => {
    wsServer.broadcastEvent('transactionPaused', session);
});

transactionManager.on('transactionResumed', (session) => {
    wsServer.broadcastEvent('transactionResumed', session);
});

transactionManager.on('sessionUpdated', (session) => {
    wsServer.broadcastSession(session);
});

scenarioEngine.on('scenarioExecuted', (event) => {
    wsServer.broadcastEvent('scenarioExecuted', event);
});

// Periodic status updates. The shape MUST match /api/status — the
// frontend handles both transports with the same reducer, so any field
// the HTTP poll surfaces (connectors, numberOfConnectors, ...) must
// also flow through the WebSocket push, otherwise listeners overwrite
// good state with a partial payload twice a second.
setInterval(() => {
    const sessions = transactionManager.getAllSessions();
    const connectorCount = chargePoint.getNumberOfConnectors();
    const connectors = [];
    for (let id = 1; id <= connectorCount; id++) {
        connectors.push({
            id,
            status: chargePoint.getConnectorStatus(id),
            hasActiveSession: transactionManager.hasActiveSession(id),
        });
    }

    wsServer.broadcastStatus({
        connected: chargePoint.isConnectedToServer(),
        numberOfConnectors: connectorCount,
        sessions: sessions.map(session => ({
            connectorId: session.connectorId,
            transactionId: session.transactionId,
            idTag: session.idTag,
            status: session.status,
            powerKw: session.powerKw,
            energyKwh: session.energyKwh,
            duration: session.duration,
            startTime: session.startTime,
        })),
        connectors,
        timestamp: new Date(),
    });
}, 2000);

// Handle remote start transaction from OCPP server
chargePoint.on('remoteStartTransaction', async (data: { connectorId: number; idTag: string; isRemoteStart: boolean }) => {
    try {
        logger.info('Server', 'remote_start.dispatch', { connector_id: data.connectorId, id_tag: data.idTag });
        await transactionManager.startTransaction(data.connectorId, data.idTag, data.isRemoteStart);
    } catch (error) {
        logger.error('Server', 'remote_start.failed', { connector_id: data.connectorId, id_tag: data.idTag, error: (error as Error).message });
    }
});

// Handle remote stop transaction from OCPP server
chargePoint.on('remoteStopTransaction', async (payload: { transactionId: number }) => {
    try {
        console.log('[Server] Remote stop transaction event received:', payload);
        console.log('[Server] Looking for transaction ID:', payload.transactionId);

        // Find the session with the matching transaction ID
        const sessions = transactionManager.getAllSessions();
        console.log('[Server] Active sessions:', sessions.map(s => ({
            connectorId: s.connectorId,
            transactionId: s.transactionId,
            idTag: s.idTag,
            status: s.status
        })));

        const session = sessions.find(s => s.transactionId === payload.transactionId);

        if (session) {
            console.log(`[Server] Found session! Stopping transaction ${payload.transactionId} on connector ${session.connectorId}`);
            await transactionManager.stopTransaction(session.connectorId, 'Remote');
        } else {
            console.warn(`[Server] Transaction ${payload.transactionId} not found in active sessions`);
            console.warn(`[Server] Available transaction IDs:`, sessions.map(s => s.transactionId));
        }
    } catch (error) {
        console.error('[Server] Error handling remote stop transaction:', error);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully');
    transactionManager.cleanup();
    chargePoint.disconnect();
    server.close(() => {
        console.log('[Server] Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully');
    transactionManager.cleanup();
    chargePoint.disconnect();
    server.close(() => {
        console.log('[Server] Server closed');
        process.exit(0);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`[Server] OCPP Charge Point Simulator API running on port ${PORT}`);
    console.log(`[Server] Charge Point ID: ${config.chargePointId}`);
    console.log(`[Server] OCPP Server URL: ${config.ocppServerUrl}`);
    console.log(`[Server] Max Power: ${config.maxPowerKw}kW`);
    console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
