import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { ChargePointConfiguration, ConnectorStatus, OCPPConfiguration } from '../models/Configuration';
import { ConfigurationManager } from './ConfigurationManager';
import { AuthorizationManager } from './AuthorizationManager';
import { logger } from '../utils/logger';

const COMPONENT = 'ChargePoint';

export enum OCPPMessageType {
    CALL = 2,
    CALLRESULT = 3,
    CALLERROR = 4
}

export interface OCPPMessage {
    messageTypeId: OCPPMessageType;
    uniqueId: string;
    action?: string;
    payload: any;
    errorCode?: string;
    errorDescription?: string;
}

export class ChargePoint extends EventEmitter {
    private ws: WebSocket | null = null;
    private config: ChargePointConfiguration;
    private pendingRequests: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isConnected: boolean = false;
    private configManager: ConfigurationManager;
    private authorizationManager!: AuthorizationManager; // Initialized after construction
    private connectorStatus: Map<number, ConnectorStatus> = new Map();

    constructor(config: ChargePointConfiguration) {
        super();
        this.config = config;
        this.configManager = new ConfigurationManager(config.chargePointId, config.numberOfConnectors);

        // Initialize connector status
        for (let i = 1; i <= config.numberOfConnectors; i++) {
            this.connectorStatus.set(i, ConnectorStatus.Available);
        }

        // Listen to configuration changes
        this.configManager.on('configurationChanged', ({ key, newValue }) => {
            this.handleConfigurationChange(key, newValue);
        });
    }

    /**
     * Set authorization manager (called after construction to avoid circular dependency)
     */
    public setAuthorizationManager(authManager: AuthorizationManager): void {
        this.authorizationManager = authManager;
        console.log('[ChargePoint] Authorization manager set');
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = `${this.config.ocppServerUrl}/${this.config.chargePointId}`;
                this.ws = new WebSocket(url, ['ocpp1.6']);

                this.ws.on('open', async () => {
                    this.isConnected = true;
                    this.emit('connected');
                    logger.info(COMPONENT, 'ws.connected', { url });

                    // Send BootNotification
                    try {
                        await this.sendBootNotification();

                        // After boot, kick off status notifications for all
                        // connectors. Fire-and-forget on purpose — a single
                        // CALLERROR or per-message timeout from the CSMS
                        // must not block the heartbeat loop, otherwise the
                        // CSMS marks us offline and the connection looks
                        // healthy from our side but silent from theirs.
                        // Per-connector failures are logged inside the
                        // helper.
                        void this.sendConnectorStatusNotifications();

                        this.startHeartbeat();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data.toString());
                });

                this.ws.on('close', (code, reason) => {
                    this.isConnected = false;
                    this.emit('disconnected');
                    logger.warn(COMPONENT, 'ws.disconnected', { close_code: code, close_reason: reason?.toString() });
                    this.stopHeartbeat();
                    this.scheduleReconnect();
                });

                this.ws.on('error', (error) => {
                    logger.error(COMPONENT, 'ws.error', { error: error.message });
                    this.emit('error', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    public disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout) return;

        this.reconnectTimeout = setTimeout(() => {
            logger.info(COMPONENT, 'ws.reconnect_attempt');
            this.reconnectTimeout = null;
            this.connect().catch(err => {
                logger.error(COMPONENT, 'ws.reconnect_failed', { error: err.message });
            });
        }, 5000);
    }

    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data) as any[];
            this.emit('message', { direction: 'incoming', data: message });

            const messageTypeId = message[0] as OCPPMessageType;
            const uniqueId = message[1] as string;

            if (messageTypeId === OCPPMessageType.CALL) {
                const action = message[2] as string;
                const payload = message[3];
                logger.info(COMPONENT, 'ocpp.recv.call', { message_id: uniqueId, action, payload });
                this.handleRequest(uniqueId, action, payload);
            } else if (messageTypeId === OCPPMessageType.CALLRESULT) {
                const payload = message[2];
                logger.debug(COMPONENT, 'ocpp.recv.result', { message_id: uniqueId, payload });
                this.handleResponse(uniqueId, payload);
            } else if (messageTypeId === OCPPMessageType.CALLERROR) {
                const errorCode = message[2];
                const errorDescription = message[3];
                const errorDetails = message[4];
                logger.error(COMPONENT, 'ocpp.recv.error', { message_id: uniqueId, error_code: errorCode, error_description: errorDescription, error_details: errorDetails });
                this.handleError(uniqueId, errorCode, errorDescription, errorDetails);
            }
        } catch (error) {
            logger.error(COMPONENT, 'ocpp.parse_error', { error: (error as Error).message, raw: data.slice(0, 500) });
        }
    }

    private async handleRequest(uniqueId: string, action: string, payload: any): Promise<void> {

        let response: any;

        try {
            switch (action) {
                case 'RemoteStartTransaction':
                    response = await this.handleRemoteStartTransaction(payload);
                    break;
                case 'RemoteStopTransaction':
                    response = await this.handleRemoteStopTransaction(payload);
                    break;
                case 'GetConfiguration':
                    response = this.handleGetConfiguration(payload);
                    break;
                case 'ChangeConfiguration':
                    response = this.handleChangeConfiguration(payload);
                    break;
                case 'Reset':
                    response = this.handleReset(payload);
                    break;
                case 'UnlockConnector':
                    response = this.handleUnlockConnector(payload);
                    break;
                case 'TriggerMessage':
                    response = await this.handleTriggerMessage(payload);
                    break;
                case 'DataTransfer':
                    response = this.handleDataTransfer(payload);
                    break;
                default:
                    this.sendCallError(uniqueId, 'NotImplemented', `Action ${action} not implemented`);
                    return;
            }

            this.sendCallResult(uniqueId, response);
        } catch (error: any) {
            this.sendCallError(uniqueId, 'InternalError', error.message);
        }
    }

    private handleResponse(uniqueId: string, payload: any): void {
        const pending = this.pendingRequests.get(uniqueId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(uniqueId);
            pending.resolve(payload);
        }
    }

    private handleError(uniqueId: string, errorCode: string, errorDescription: string, errorDetails: any): void {
        const pending = this.pendingRequests.get(uniqueId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(uniqueId);
            pending.reject(new Error(`${errorCode}: ${errorDescription}`));
        }
    }

    private sendCall(action: string, payload: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || !this.isConnected) {
                reject(new Error('Not connected to server'));
                return;
            }

            const uniqueId = uuidv4();
            const message = [OCPPMessageType.CALL, uniqueId, action, payload];

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(uniqueId);
                reject(new Error(`Request timeout for ${action}`));
            }, 30000);

            this.pendingRequests.set(uniqueId, { resolve, reject, timeout });

            const messageStr = JSON.stringify(message);
            this.ws.send(messageStr);
            this.emit('message', { direction: 'outgoing', data: message });
            logger.info(COMPONENT, 'ocpp.send.call', { message_id: uniqueId, action, payload });
        });
    }

    private sendCallResult(uniqueId: string, payload: any): void {
        if (!this.ws || !this.isConnected) return;

        const message = [OCPPMessageType.CALLRESULT, uniqueId, payload];
        const messageStr = JSON.stringify(message);
        this.ws.send(messageStr);
        this.emit('message', { direction: 'outgoing', data: message });
    }

    private sendCallError(uniqueId: string, errorCode: string, errorDescription: string, errorDetails: any = {}): void {
        if (!this.ws || !this.isConnected) return;

        const message = [OCPPMessageType.CALLERROR, uniqueId, errorCode, errorDescription, errorDetails];
        const messageStr = JSON.stringify(message);
        this.ws.send(messageStr);
        this.emit('message', { direction: 'outgoing', data: message });
    }

    // OCPP Message Handlers
    public async sendBootNotification(): Promise<any> {
        const payload = {
            chargePointVendor: 'Eveys',
            chargePointModel: 'Eveys-22kW-AC',
            chargePointSerialNumber: this.config.chargePointId,
            firmwareVersion: '1.0.0',
            iccid: '',
            imsi: '',
            meterType: 'Virtual',
            meterSerialNumber: `METER-${this.config.chargePointId}`
        };

        const response = await this.sendCall('BootNotification', payload);

        if (response.status === 'Accepted') {
            // Update heartbeat interval if provided
            if (response.interval) {
                this.configManager.changeConfiguration('HeartbeatInterval', response.interval.toString());
            }
        }

        return response;
    }

    /**
     * Send status notifications for all connectors after boot
     * This ensures the server knows the current state of all connectors
     */
    private async sendConnectorStatusNotifications(): Promise<void> {
        console.log('[ChargePoint] Sending status notifications for all connectors after boot');

        // Emit event to check for orphaned transactions
        this.emit('bootCompleted');

        // Send status notification for each connector
        for (let connectorId = 1; connectorId <= this.config.numberOfConnectors; connectorId++) {
            const status = this.connectorStatus.get(connectorId) || ConnectorStatus.Available;
            try {
                await this.sendStatusNotification(connectorId, status);
                console.log(`[ChargePoint] Sent status notification for connector ${connectorId}: ${status}`);
            } catch (error) {
                console.error(`[ChargePoint] Failed to send status notification for connector ${connectorId}:`, error);
            }
        }
    }

    public async sendHeartbeat(): Promise<any> {
        return this.sendCall('Heartbeat', {});
    }

    public async sendStatusNotification(connectorId: number, status: ConnectorStatus, errorCode: string = 'NoError'): Promise<any> {
        this.connectorStatus.set(connectorId, status);

        const payload = {
            connectorId,
            errorCode,
            status,
            timestamp: new Date().toISOString()
        };

        return this.sendCall('StatusNotification', payload);
    }

    public async sendAuthorize(idTag: string): Promise<any> {
        return this.sendCall('Authorize', { idTag });
    }

    public async sendStartTransaction(connectorId: number, idTag: string, meterStart: number): Promise<any> {
        // OCPP 1.6 §6.51: meterStart is `integer` Wh on the wire. Internal
        // storage keeps fractional Wh (1-second power*time accumulators)
        // for precision; we coerce at this boundary so the CSMS gets a
        // schema-valid payload instead of a TypeConstraintViolation.
        const payload = {
            connectorId,
            idTag,
            meterStart: Math.round(meterStart),
            timestamp: new Date().toISOString()
        };

        return this.sendCall('StartTransaction', payload);
    }

    public async sendStopTransaction(transactionId: number, meterStop: number, idTag: string, reason: string = 'Local'): Promise<any> {
        // OCPP 1.6 §6.55: meterStop is `integer` Wh on the wire. Same
        // float-to-int coercion as sendStartTransaction — see comment there.
        const payload = {
            transactionId,
            meterStop: Math.round(meterStop),
            timestamp: new Date().toISOString(),
            idTag,
            reason
        };

        return this.sendCall('StopTransaction', payload);
    }

    public async sendMeterValues(connectorId: number, transactionId: number | undefined, meterValue: any[]): Promise<any> {
        const payload: any = {
            connectorId,
            meterValue
        };

        if (transactionId !== undefined) {
            payload.transactionId = transactionId;
        }

        return this.sendCall('MeterValues', payload);
    }

    public async sendDataTransfer(vendorId: string, messageId?: string, data?: any): Promise<any> {
        const payload: any = {
            vendorId
        };

        if (messageId) {
            payload.messageId = messageId;
        }

        if (data) {
            payload.data = typeof data === 'string' ? data : JSON.stringify(data);
        }

        return this.sendCall('DataTransfer', payload);
    }

    // Request Handlers from Central System
    private async handleRemoteStartTransaction(payload: any): Promise<any> {
        try {
            const connectorId = payload.connectorId || 1;
            const idTag = payload.idTag;

            logger.info(COMPONENT, 'remote_start.received', { connector_id: connectorId, id_tag: idTag });

            // Per OCPP 1.6 §5.11 the charge point's CALLRESULT only confirms
            // that the request shape was understood, not that the transaction
            // started. The actual StartTransaction CALL is fired async from
            // TransactionManager — failure paths there log distinct events
            // (start_transaction.attempt_failed, etc.).
            this.emit('remoteStartTransaction', { connectorId, idTag, isRemoteStart: true });

            return { status: 'Accepted' };
        } catch (error) {
            logger.error(COMPONENT, 'remote_start.handler_error', { error: (error as Error).message });
            return { status: 'Rejected' };
        }
    }

    private async handleRemoteStopTransaction(payload: any): Promise<any> {
        this.emit('remoteStopTransaction', payload);
        return { status: 'Accepted' };
    }

    private handleGetConfiguration(payload: any): any {
        const { key } = payload;
        return this.configManager.getConfiguration(key);
    }

    private handleChangeConfiguration(payload: any): any {
        const { key, value } = payload;
        const status = this.configManager.changeConfiguration(key, value);
        return { status };
    }

    private handleReset(payload: any): any {
        const { type } = payload;
        this.emit('reset', { type });
        return { status: 'Accepted' };
    }

    private handleUnlockConnector(payload: any): any {
        const { connectorId } = payload;
        this.emit('unlockConnector', { connectorId });
        return { status: 'Unlocked' };
    }

    private async handleTriggerMessage(payload: any): Promise<any> {
        const { requestedMessage, connectorId } = payload;

        switch (requestedMessage) {
            case 'BootNotification':
                await this.sendBootNotification();
                break;
            case 'Heartbeat':
                await this.sendHeartbeat();
                break;
            case 'StatusNotification':
                if (connectorId !== undefined) {
                    const status = this.connectorStatus.get(connectorId) || ConnectorStatus.Available;
                    await this.sendStatusNotification(connectorId, status);
                }
                break;
            default:
                return { status: 'NotImplemented' };
        }

        return { status: 'Accepted' };
    }

    private handleDataTransfer(payload: any): any {
        const { vendorId, messageId, data } = payload;
        this.emit('dataTransfer', { vendorId, messageId, data });

        // Return accepted by default - can be customized based on vendorId/messageId
        return { status: 'Accepted' };
    }

    /**
     * Handle configuration changes and apply them to simulator behavior
     */
    private handleConfigurationChange(key: string, newValue: string): void {
        console.log(`[ChargePoint] Configuration changed: ${key} = ${newValue}`);

        // Apply configuration changes to runtime behavior
        switch (key) {
            case 'HeartbeatInterval':
                // Restart heartbeat with new interval
                if (this.isConnected) {
                    this.startHeartbeat();
                }
                break;
            case 'MeterValueSampleInterval':
                // Emit event for TransactionManager to update its interval
                const intervalSeconds = parseInt(newValue);
                if (!isNaN(intervalSeconds)) {
                    console.log(`[ChargePoint] Emitting meterValueIntervalChanged: ${intervalSeconds}s`);
                    this.emit('meterValueIntervalChanged', intervalSeconds);
                }
                break;
            // Add more cases as needed
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();

        const interval = this.configManager.getValueAsNumber('HeartbeatInterval', this.config.heartbeatInterval) * 1000;

        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat().catch(err => {
                console.error('[ChargePoint] Heartbeat failed:', err);
            });
        }, interval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    public getConnectorStatus(connectorId: number): ConnectorStatus {
        return this.connectorStatus.get(connectorId) || ConnectorStatus.Available;
    }

    public getNumberOfConnectors(): number {
        return this.config.numberOfConnectors;
    }

    public isConnectedToServer(): boolean {
        return this.isConnected;
    }

    public getConfiguration(): OCPPConfiguration[] {
        return this.configManager.getAllConfiguration();
    }

    public getConfigurationManager(): ConfigurationManager {
        return this.configManager;
    }

}
