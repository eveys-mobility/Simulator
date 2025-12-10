import { EventEmitter } from 'events';
import { ChargePoint } from './ChargePoint';
import {
    ChargingSession,
    SessionStatus,
    MeterValue,
    SampledValue,
    Measurand,
    UnitOfMeasure,
    ReadingContext,
    Phase
} from '../models/ChargingSession';
import { ConnectorStatus } from '../models/Configuration';
import { ConfigurationManager } from './ConfigurationManager';
import { MeterValueStorage } from './MeterValueStorage';
import { TransactionTracker } from './TransactionTracker';
import { TransactionHistory } from './TransactionHistory';
import { AuthorizationManager } from './AuthorizationManager';

export class TransactionManager extends EventEmitter {
    private chargePoint: ChargePoint;
    private sessions: Map<number, ChargingSession> = new Map();
    private meterValueIntervals: Map<number, NodeJS.Timeout> = new Map();
    private chargingSimulationIntervals: Map<number, NodeJS.Timeout> = new Map();
    private maxPowerKw: number;
    private meterValueIntervalSeconds: number;
    private configManager: ConfigurationManager;
    private meterStorage: MeterValueStorage;
    private transactionTracker: TransactionTracker;
    private transactionHistory: TransactionHistory;
    private authorizationManager!: AuthorizationManager; // Set after construction

    constructor(chargePoint: ChargePoint, configManager: ConfigurationManager, chargePointId: string, maxPowerKw: number, meterValueIntervalSeconds: number = 60) {
        super();
        this.chargePoint = chargePoint;
        this.configManager = configManager;
        this.meterStorage = new MeterValueStorage(chargePointId);
        this.transactionTracker = new TransactionTracker(chargePointId);
        this.transactionHistory = new TransactionHistory(chargePointId, 50); // Store last 50 transactions
        this.maxPowerKw = maxPowerKw;
        this.meterValueIntervalSeconds = meterValueIntervalSeconds;

        // Listen to configuration changes
        this.chargePoint.on('meterValueIntervalChanged', (newInterval: number) => {
            console.log(`[TransactionManager] Received meterValueIntervalChanged event: ${newInterval}s`);
            console.log(`[TransactionManager] Old interval: ${this.meterValueIntervalSeconds}s`);
            this.meterValueIntervalSeconds = newInterval;

            // Restart meter value reporting for active sessions
            const activeSessions = Array.from(this.sessions.entries()).filter(
                ([_, session]) => session.status === SessionStatus.Charging
            );

            console.log(`[TransactionManager] Active charging sessions: ${activeSessions.length}`);

            activeSessions.forEach(([connectorId, session]) => {
                console.log(`[TransactionManager] Restarting meter value reporting for connector ${connectorId} with new interval ${newInterval}s`);
                this.stopMeterValueReporting(connectorId);
                this.startMeterValueReporting(connectorId);
            });
        });
    }

    /**
     * Set authorization manager (called after construction)
     */
    public setAuthorizationManager(authManager: AuthorizationManager): void {
        this.authorizationManager = authManager;
        console.log('[TransactionManager] Authorization manager set');
    }

    public async startTransaction(connectorId: number, idTag: string, isRemoteStart: boolean = false): Promise<ChargingSession> {
        // Check if connected to OCPP server - CRITICAL: No offline charging allowed
        if (!this.chargePoint.isConnectedToServer()) {
            throw new Error('Cannot start charging: Not connected to OCPP server. Please connect first.');
        }

        // Check if connector is available
        const status = this.chargePoint.getConnectorStatus(connectorId);
        if (status !== ConnectorStatus.Available) {
            throw new Error(`Connector ${connectorId} is not available (status: ${status})`);
        }

        // Check if session already exists
        if (this.sessions.has(connectorId)) {
            throw new Error(`Connector ${connectorId} already has an active session`);
        }

        // CRITICAL: Authorize ID tag using AuthorizationManager
        console.log(`[TransactionManager] Authorizing ID tag: ${idTag}`);
        const idTagInfo = await this.authorizationManager.authorize(idTag);

        if (idTagInfo.status !== 'Accepted') {
            throw new Error(`Authorization failed: ${idTagInfo.status}`);
        }

        // Check for concurrent transaction
        if (this.authorizationManager.hasConcurrentTransaction(idTag)) {
            throw new Error(`ID tag ${idTag} already has an active transaction`);
        }

        // Check tag expiry
        if (idTagInfo.expiryDate && new Date(idTagInfo.expiryDate) < new Date()) {
            throw new Error(`ID tag ${idTag} has expired`);
        }

        console.log(`[TransactionManager] ID tag ${idTag} authorized successfully`);

        // Update status to Preparing
        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Preparing);

        // Generate unique local transaction ID immediately
        const localTransactionId = this.generateUniqueTransactionId();
        console.log(`[TransactionManager] Generated unique transaction ID: ${localTransactionId}`);

        // Get current meter value from persistent storage
        const startMeterValue = this.meterStorage.getMeterValue(connectorId);
        console.log(`[TransactionManager] Starting meter value for connector ${connectorId}: ${startMeterValue} Wh`);

        // Create session with local transaction ID and persistent meter value
        const session: ChargingSession = {
            connectorId,
            idTag,
            startTime: new Date(),
            startMeterValue,
            currentMeterValue: startMeterValue,
            status: SessionStatus.Preparing,
            powerKw: 0,
            energyKwh: 0,
            duration: 0,
            transactionId: localTransactionId  // Use local ID immediately
        };

        this.sessions.set(connectorId, session);

        // Start transaction with OCPP (with retry logic)
        const maxAttempts = this.configManager.getValueAsNumber('TransactionMessageAttempts', 3);
        const retryInterval = this.configManager.getValueAsNumber('TransactionMessageRetryInterval', 20);

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`[TransactionManager] Sending StartTransaction (attempt ${attempt}/${maxAttempts})`);

                const response = await this.chargePoint.sendStartTransaction(connectorId, idTag, startMeterValue);

                if (response.idTagInfo.status !== 'Accepted') {
                    throw new Error(`Transaction start rejected: ${response.idTagInfo.status}`);
                }

                // Handle transaction ID based on start type
                if (isRemoteStart) {
                    // For remote starts: use server-assigned transaction ID
                    session.transactionId = response.transactionId;
                    console.log(`[TransactionManager] Remote start - using server transaction ID: ${response.transactionId}`);
                } else {
                    // For local starts: keep our local unique ID
                    console.log(`[TransactionManager] Local start - server assigned ID: ${response.transactionId}, using local ID: ${localTransactionId}`);
                    // session.transactionId already set to localTransactionId, don't change it
                }

                // CRITICAL: Register transaction in tracker to ensure it gets stopped
                this.transactionTracker.registerTransaction(
                    connectorId,
                    session.transactionId!,
                    idTag,
                    startMeterValue,
                    isRemoteStart
                );

                // CRITICAL: Register active transaction with AuthorizationManager
                this.authorizationManager.registerActiveTransaction(idTag, session.transactionId!);

                // Record transaction start in history
                this.transactionHistory.addStartedTransaction(
                    session.transactionId!,
                    connectorId,
                    idTag,
                    startMeterValue,
                    isRemoteStart
                );

                // Update status to Charging
                session.status = SessionStatus.Charging;
                await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Charging);

                // Apply current limiter configuration
                const currentLimit = this.configManager.getValueAsNumber('CurrentLimiterValue', 32);
                const voltage = 400; // 3-phase voltage
                const maxPowerFromCurrent = (currentLimit * voltage * Math.sqrt(3)) / 1000; // kW
                this.maxPowerKw = Math.min(this.maxPowerKw, maxPowerFromCurrent);

                // Start charging simulation
                this.startChargingSimulation(connectorId);

                // Start meter value reporting
                this.startMeterValueReporting(connectorId);

                this.emit('transactionStarted', session);
                return session;

            } catch (error) {
                lastError = error as Error;
                console.error(`[TransactionManager] StartTransaction attempt ${attempt}/${maxAttempts} failed:`, error);

                if (attempt < maxAttempts) {
                    console.log(`[TransactionManager] Retrying in ${retryInterval} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryInterval * 1000));
                }
            }
        }

        // All attempts failed
        this.sessions.delete(connectorId);
        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Available);
        throw lastError || new Error('StartTransaction failed after all retry attempts');
    }

    public async stopTransaction(connectorId: number, reason: string = 'Local'): Promise<void> {
        const session = this.sessions.get(connectorId);
        if (!session || !session.transactionId) {
            throw new Error(`No active transaction on connector ${connectorId}`);
        }

        // Stop charging simulation
        this.stopChargingSimulation(connectorId);

        // Stop meter value reporting
        this.stopMeterValueReporting(connectorId);

        // Update status
        session.status = SessionStatus.Finishing;
        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Finishing);

        // Send final meter values
        await this.sendMeterValues(connectorId, session, ReadingContext.TransactionEnd);

        // Stop transaction with OCPP (with retry logic)
        const maxAttempts = this.configManager.getValueAsNumber('TransactionMessageAttempts', 3);
        const retryInterval = this.configManager.getValueAsNumber('TransactionMessageRetryInterval', 20);

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Send StopTransaction
                await this.chargePoint.sendStopTransaction(
                    session.transactionId,
                    session.currentMeterValue,
                    session.idTag,
                    reason
                );

                // CRITICAL: Unregister transaction from tracker
                this.transactionTracker.unregisterTransaction(connectorId);

                // CRITICAL: Unregister active transaction from AuthorizationManager
                this.authorizationManager.unregisterActiveTransaction(session.idTag);

                // Complete transaction in history
                const stopMeterValue = this.meterStorage.getMeterValue(connectorId);
                const energyConsumed = (stopMeterValue - session.startMeterValue) / 1000; // Convert Wh to kWh
                const duration = Math.floor((new Date().getTime() - session.startTime.getTime()) / 1000); // seconds

                this.transactionHistory.completeTransaction(
                    session.transactionId,
                    stopMeterValue,
                    reason
                );

                // Stop charging simulation and meter value reporting
                this.stopChargingSimulation(connectorId);
                this.stopMeterValueReporting(connectorId);

                // Remove session
                this.sessions.delete(connectorId);

                // Update connector status to Available
                await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Available);

                this.emit('transactionStopped', session);
                console.log(`[TransactionManager] Transaction ${session.transactionId} stopped successfully`);
                return;

            } catch (error) {
                lastError = error as Error;
                console.error(`[TransactionManager] StopTransaction attempt ${attempt}/${maxAttempts} failed:`, error);

                if (attempt < maxAttempts) {
                    console.log(`[TransactionManager] Retrying in ${retryInterval} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryInterval * 1000));
                }
            }
        }

        // All attempts failed - still cleanup local state
        console.error('[TransactionManager] All StopTransaction attempts failed, cleaning up local state');

        // CRITICAL: Unregister from AuthorizationManager even on failure
        this.authorizationManager.unregisterActiveTransaction(session.idTag);

        this.stopChargingSimulation(connectorId);
        this.stopMeterValueReporting(connectorId);
        this.sessions.delete(connectorId);
        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Available);

        throw lastError || new Error('StopTransaction failed after all retry attempts');
    }

    public async pauseTransaction(connectorId: number): Promise<void> {
        const session = this.sessions.get(connectorId);
        if (!session || session.status !== SessionStatus.Charging) {
            throw new Error(`No active charging session on connector ${connectorId}`);
        }

        this.stopChargingSimulation(connectorId);
        session.status = SessionStatus.Paused;
        session.powerKw = 0;

        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.SuspendedEV);
        this.emit('transactionPaused', session);
    }

    public async resumeTransaction(connectorId: number): Promise<void> {
        const session = this.sessions.get(connectorId);
        if (!session || session.status !== SessionStatus.Paused) {
            throw new Error(`No paused session on connector ${connectorId}`);
        }

        session.status = SessionStatus.Charging;
        this.startChargingSimulation(connectorId);

        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Charging);
        this.emit('transactionResumed', session);
    }

    private startChargingSimulation(connectorId: number): void {
        const session = this.sessions.get(connectorId);
        if (!session) return;

        let elapsedSeconds = 0;
        const rampUpDuration = 5; // seconds to reach max power

        const interval = setInterval(() => {
            if (!this.sessions.has(connectorId)) {
                clearInterval(interval);
                return;
            }

            elapsedSeconds++;
            session.duration = Math.floor((Date.now() - session.startTime.getTime()) / 1000);

            // Power ramp-up simulation
            if (elapsedSeconds <= rampUpDuration) {
                session.powerKw = (this.maxPowerKw / rampUpDuration) * elapsedSeconds;
            } else {
                session.powerKw = this.maxPowerKw;
            }

            // Calculate energy (kWh = kW * hours)
            const energyIncrementKwh = session.powerKw / 3600; // per second
            const energyIncrementWh = energyIncrementKwh * 1000; // Convert to Wh

            // Increment persistent meter value
            const newMeterValue = this.meterStorage.incrementMeterValue(connectorId, energyIncrementWh);
            session.currentMeterValue = newMeterValue;
            session.energyKwh = (newMeterValue - session.startMeterValue) / 1000; // Session energy

            this.emit('sessionUpdated', session);
        }, 1000);

        this.chargingSimulationIntervals.set(connectorId, interval);
    }

    private stopChargingSimulation(connectorId: number): void {
        const interval = this.chargingSimulationIntervals.get(connectorId);
        if (interval) {
            clearInterval(interval);
            this.chargingSimulationIntervals.delete(connectorId);
        }

        const session = this.sessions.get(connectorId);
        if (session) {
            session.powerKw = 0;
        }
    }

    private startMeterValueReporting(connectorId: number): void {
        const session = this.sessions.get(connectorId);
        if (!session) return;

        // Send initial meter values
        this.sendMeterValues(connectorId, session, ReadingContext.TransactionBegin);

        // Get interval from configuration
        const intervalSeconds = this.configManager.getValueAsNumber('MeterValueSampleInterval', this.meterValueIntervalSeconds);

        // Set up periodic reporting
        const interval = setInterval(() => {
            const currentSession = this.sessions.get(connectorId);
            if (!currentSession) {
                clearInterval(interval);
                return;
            }

            this.sendMeterValues(connectorId, currentSession, ReadingContext.SamplePeriodic);
        }, intervalSeconds * 1000);

        this.meterValueIntervals.set(connectorId, interval);
    }

    private stopMeterValueReporting(connectorId: number): void {
        const interval = this.meterValueIntervals.get(connectorId);
        if (interval) {
            clearInterval(interval);
            this.meterValueIntervals.delete(connectorId);
        }
    }

    private async sendMeterValues(connectorId: number, session: ChargingSession, context: ReadingContext): Promise<void> {
        // Always read the latest meter value from persistent storage
        const currentMeterValue = this.meterStorage.getMeterValue(connectorId);

        // Update session with latest value
        session.currentMeterValue = currentMeterValue;
        session.energyKwh = (currentMeterValue - session.startMeterValue) / 1000;

        // Get configured measurands
        const measurandsConfig = this.configManager.getValue('MeterValuesSampledData') ||
            'Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage';
        const measurands = measurandsConfig.split(',').map(m => m.trim());

        const sampledValue: SampledValue[] = [];

        // Add each configured measurand
        if (measurands.includes('Energy.Active.Import.Register')) {
            sampledValue.push({
                value: currentMeterValue.toString(),
                context,
                measurand: Measurand.EnergyActiveImportRegister,
                unit: UnitOfMeasure.Wh
            });
        }

        if (measurands.includes('Power.Active.Import')) {
            // Get current power from configuration or use session power
            const currentLimitA = this.configManager.getValueAsNumber('CurrentLimiterValue', 32);
            const voltage = 400; // 3-phase voltage
            const maxPowerKw = (currentLimitA * voltage * Math.sqrt(3)) / 1000;
            const actualPower = Math.min(session.powerKw, maxPowerKw);

            sampledValue.push({
                value: (actualPower * 1000).toString(), // Convert to W
                context,
                measurand: Measurand.PowerActiveImport,
                unit: UnitOfMeasure.W
            });
        }

        if (measurands.includes('Current.Import')) {
            const current = this.calculateCurrent(session.powerKw);
            sampledValue.push({
                value: current.toFixed(1),
                context,
                measurand: Measurand.CurrentImport,
                unit: UnitOfMeasure.A,
                phase: Phase.L1
            });
        }

        if (measurands.includes('Voltage')) {
            sampledValue.push({
                value: '230',
                context,
                measurand: Measurand.Voltage,
                unit: UnitOfMeasure.V,
                phase: Phase.L1
            });
        }

        if (measurands.includes('Temperature')) {
            const temp = 25 + Math.random() * 10; // 25-35°C
            sampledValue.push({
                value: temp.toFixed(1),
                context,
                measurand: Measurand.Temperature,
                unit: UnitOfMeasure.Celsius
            });
        }

        if (measurands.includes('SoC')) {
            const soc = Math.min(100, (session.energyKwh / 50) * 100); // Assume 50kWh battery
            sampledValue.push({
                value: soc.toFixed(0),
                context,
                measurand: Measurand.SoC,
                unit: UnitOfMeasure.Percent
            });
        }

        if (measurands.includes('Frequency')) {
            sampledValue.push({
                value: '50',
                context,
                measurand: Measurand.Frequency,
                unit: UnitOfMeasure.Hertz
            });
        }

        const meterValue: MeterValue[] = [{
            timestamp: new Date().toISOString() as any,
            sampledValue
        }];

        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
            try {
                await this.chargePoint.sendMeterValues(connectorId, session.transactionId!, meterValue);
                console.log(`[TransactionManager] Meter values sent successfully for connector ${connectorId} (${sampledValue.length} measurands)`);
                return;
            } catch (error) {
                retries++;
                console.error(`[TransactionManager] Error sending meter values (attempt ${retries}/${maxRetries}):`, error);

                if (retries >= maxRetries) {
                    // Emit error event after all retries exhausted
                    this.emit('meterValueError', {
                        connectorId,
                        transactionId: session.transactionId,
                        error: error instanceof Error ? error.message : 'Unknown error',
                        context
                    });
                } else {
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries - 1)));
                }
            }
        }
    }

    private calculateCurrent(powerKw: number): number {
        // For 3-phase 400V: I = P / (√3 * V)
        // Simplified: I ≈ P / 0.69 (for 400V 3-phase)
        return powerKw / 0.69;
    }

    public getSession(connectorId: number): ChargingSession | undefined {
        return this.sessions.get(connectorId);
    }

    public getAllSessions(): ChargingSession[] {
        return Array.from(this.sessions.values());
    }

    public hasActiveSession(connectorId: number): boolean {
        return this.sessions.has(connectorId);
    }

    /**
     * Generate a unique transaction ID
     * Format: Timestamp (milliseconds since epoch) + 3-digit random number
     * This ensures uniqueness even for rapid successive transactions
     */
    private generateUniqueTransactionId(): number {
        const timestamp = Date.now(); // Milliseconds since epoch
        const random = Math.floor(Math.random() * 1000); // 0-999
        const uniqueId = timestamp * 1000 + random;

        console.log(`[TransactionManager] Generated transaction ID: ${uniqueId} (timestamp: ${timestamp}, random: ${random})`);
        return uniqueId;
    }

    public cleanup(): void {
        // Stop all simulations
        this.chargingSimulationIntervals.forEach(interval => clearInterval(interval));
        this.chargingSimulationIntervals.clear();

        // Stop all meter value reporting
        this.meterValueIntervals.forEach(interval => clearInterval(interval));
        this.meterValueIntervals.clear();
    }

    /**
     * Get orphaned transactions (started but not stopped)
     * These should be stopped on reconnection or restart
     */
    public getOrphanedTransactions(): any[] {
        return this.transactionTracker.getAllActiveTransactions();
    }

    /**
     * Get transaction tracker for direct access
     */
    public getTransactionTracker(): TransactionTracker {
        return this.transactionTracker;
    }

    /**
     * Get transaction history
     */
    public getTransactionHistory(): TransactionHistory {
        return this.transactionHistory;
    }

    /**
     * Get last N transactions from history
     */
    public getLastTransactions(count: number = 10): any[] {
        return this.transactionHistory.getLastTransactions(count);
    }

    /**
     * Get transaction history statistics
     */
    public getHistoryStatistics(): any {
        return this.transactionHistory.getStatistics();
    }
}
