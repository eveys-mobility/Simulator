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
import { ChargePointConfiguration } from './models/Configuration';

// Load environment variables
dotenv.config();

const PORT = process.env.API_PORT || 3001;

// Create charge point configuration
const config: ChargePointConfiguration = {
    chargePointId: process.env.CHARGE_POINT_ID || 'CP001',
    ocppServerUrl: process.env.OCPP_SERVER_URL || 'ws://localhost:8180/steve/websocket/CentralSystemService',
    maxPowerKw: parseFloat(process.env.MAX_POWER_KW || '22'),
    connectorType: 'Type2',
    voltage: parseInt(process.env.VOLTAGE || '400'),
    maxCurrent: parseInt(process.env.MAX_CURRENT || '32'),
    numberOfConnectors: 1,
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

// Connect to OCPP server
chargePoint.connect();


// Create Express app
const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);

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

// Periodic status updates
setInterval(() => {
    const sessions = transactionManager.getAllSessions();
    wsServer.broadcastStatus({
        connected: chargePoint.isConnectedToServer(),
        sessions: sessions.map(session => ({
            connectorId: session.connectorId,
            transactionId: session.transactionId,
            status: session.status,
            powerKw: session.powerKw,
            energyKwh: session.energyKwh,
            duration: session.duration
        })),
        timestamp: new Date()
    });
}, 2000);

// Handle remote start transaction from OCPP server
chargePoint.on('remoteStartTransaction', async (data: { connectorId: number; idTag: string; isRemoteStart: boolean }) => {
    try {
        console.log('[Server] Remote start transaction event received:', data);
        // Pass isRemoteStart flag to use server transaction ID
        await transactionManager.startTransaction(data.connectorId, data.idTag, data.isRemoteStart);
    } catch (error) {
        console.error('[Server] Error handling remote start transaction:', error);
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
