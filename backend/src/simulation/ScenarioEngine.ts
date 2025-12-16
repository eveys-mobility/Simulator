import { EventEmitter } from 'events';
import { ChargePoint } from '../ocpp/ChargePoint';
import { TransactionManager } from '../ocpp/TransactionManager';
import { ConnectorStatus } from '../models/Configuration';

export enum ScenarioType {
    EmergencyStop = 'emergency_stop',
    NetworkOffline = 'network_offline',
    NetworkOnline = 'network_online',
    UserPauseFromCar = 'user_pause_from_car',
    UserResumeFromCar = 'user_resume_from_car',
    ConnectorUnlock = 'connector_unlock',
    OverTemperature = 'over_temperature',
    GroundFault = 'ground_fault',
    PowerOutage = 'power_outage',
    PowerRestored = 'power_restored'
}

export interface ScenarioResult {
    success: boolean;
    message: string;
    details?: any;
}

export class ScenarioEngine extends EventEmitter {
    private chargePoint: ChargePoint;
    private transactionManager: TransactionManager;
    private isOffline: boolean = false;

    constructor(chargePoint: ChargePoint, transactionManager: TransactionManager) {
        super();
        this.chargePoint = chargePoint;
        this.transactionManager = transactionManager;
    }

    public async executeScenario(type: ScenarioType, connectorId: number = 1): Promise<ScenarioResult> {
        console.log(`[ScenarioEngine] Executing scenario: ${type} on connector ${connectorId}`);

        try {
            switch (type) {
                case ScenarioType.EmergencyStop:
                    return await this.simulateEmergencyStop(connectorId);

                case ScenarioType.NetworkOffline:
                    return await this.simulateNetworkOffline();

                case ScenarioType.NetworkOnline:
                    return await this.simulateNetworkOnline();

                case ScenarioType.UserPauseFromCar:
                    return await this.simulateUserPauseFromCar(connectorId);

                case ScenarioType.UserResumeFromCar:
                    return await this.simulateUserResumeFromCar(connectorId);

                case ScenarioType.ConnectorUnlock:
                    return await this.simulateConnectorUnlock(connectorId);

                case ScenarioType.OverTemperature:
                    return await this.simulateOverTemperature(connectorId);

                case ScenarioType.GroundFault:
                    return await this.simulateGroundFault(connectorId);

                case ScenarioType.PowerOutage:
                    return await this.simulatePowerOutage(connectorId);

                case ScenarioType.PowerRestored:
                    return await this.simulatePowerRestored(connectorId);

                default:
                    return {
                        success: false,
                        message: `Unknown scenario type: ${type}`
                    };
            }
        } catch (error: any) {
            console.error(`[ScenarioEngine] Error executing scenario ${type}:`, error);
            return {
                success: false,
                message: error.message,
                details: error
            };
        }
    }

    private async simulateEmergencyStop(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (!session) {
            return {
                success: false,
                message: 'No active session to stop'
            };
        }

        // Send status notification for emergency stop
        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Faulted, 'EmergencyStop');

        // Stop the transaction
        await this.transactionManager.stopTransaction(connectorId, 'EmergencyStop');

        this.emit('scenarioExecuted', {
            type: ScenarioType.EmergencyStop,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Emergency stop executed successfully',
            details: { connectorId, transactionId: session.transactionId }
        };
    }

    private async simulateNetworkOffline(): Promise<ScenarioResult> {
        if (this.isOffline) {
            return {
                success: false,
                message: 'Already offline'
            };
        }

        this.chargePoint.disconnect();
        this.isOffline = true;

        this.emit('scenarioExecuted', {
            type: ScenarioType.NetworkOffline,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Network disconnected successfully'
        };
    }

    private async simulateNetworkOnline(): Promise<ScenarioResult> {
        if (!this.isOffline) {
            return {
                success: false,
                message: 'Already online'
            };
        }

        await this.chargePoint.connect();
        this.isOffline = false;

        this.emit('scenarioExecuted', {
            type: ScenarioType.NetworkOnline,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Network reconnected successfully'
        };
    }

    private async simulateUserPauseFromCar(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (!session) {
            return {
                success: false,
                message: 'No active session to pause'
            };
        }

        await this.transactionManager.pauseTransaction(connectorId);

        this.emit('scenarioExecuted', {
            type: ScenarioType.UserPauseFromCar,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'User paused charging from car',
            details: { connectorId, transactionId: session.transactionId }
        };
    }

    private async simulateUserResumeFromCar(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (!session) {
            return {
                success: false,
                message: 'No paused session to resume'
            };
        }

        await this.transactionManager.resumeTransaction(connectorId);

        this.emit('scenarioExecuted', {
            type: ScenarioType.UserResumeFromCar,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'User resumed charging from car',
            details: { connectorId, transactionId: session.transactionId }
        };
    }

    private async simulateConnectorUnlock(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (!session) {
            return {
                success: false,
                message: 'No active session'
            };
        }

        // Simulate connector unlock during charging (should stop transaction)
        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Faulted, 'ConnectorLockFailure');
        await this.transactionManager.stopTransaction(connectorId, 'UnlockCommand');

        this.emit('scenarioExecuted', {
            type: ScenarioType.ConnectorUnlock,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Connector unlocked during charging',
            details: { connectorId, transactionId: session.transactionId }
        };
    }

    private async simulateOverTemperature(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (!session) {
            return {
                success: false,
                message: 'No active session'
            };
        }

        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Faulted, 'OverCurrentFailure');
        await this.transactionManager.stopTransaction(connectorId, 'Other');

        this.emit('scenarioExecuted', {
            type: ScenarioType.OverTemperature,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Over-temperature fault simulated',
            details: { connectorId, transactionId: session.transactionId }
        };
    }

    private async simulateGroundFault(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (!session) {
            return {
                success: false,
                message: 'No active session'
            };
        }

        await this.chargePoint.sendStatusNotification(connectorId, ConnectorStatus.Faulted, 'GroundFailure');
        await this.transactionManager.stopTransaction(connectorId, 'Other');

        this.emit('scenarioExecuted', {
            type: ScenarioType.GroundFault,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Ground fault simulated',
            details: { connectorId, transactionId: session.transactionId }
        };
    }

    private async simulatePowerOutage(connectorId: number): Promise<ScenarioResult> {
        const session = this.transactionManager.getSession(connectorId);

        if (session) {
            // Pause charging but keep transaction active
            await this.transactionManager.pauseTransaction(connectorId);
        }

        // Disconnect from network
        this.chargePoint.disconnect();
        this.isOffline = true;

        this.emit('scenarioExecuted', {
            type: ScenarioType.PowerOutage,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Power outage simulated',
            details: { connectorId, hadActiveSession: !!session }
        };
    }

    private async simulatePowerRestored(connectorId: number): Promise<ScenarioResult> {
        // Reconnect to network
        await this.chargePoint.connect();
        this.isOffline = false;

        const session = this.transactionManager.getSession(connectorId);

        if (session) {
            // Resume charging if there was an active session
            await this.transactionManager.resumeTransaction(connectorId);
        }

        this.emit('scenarioExecuted', {
            type: ScenarioType.PowerRestored,
            connectorId,
            timestamp: new Date()
        });

        return {
            success: true,
            message: 'Power restored successfully',
            details: { connectorId, resumedSession: !!session }
        };
    }

    public getAvailableScenarios(): ScenarioType[] {
        return Object.values(ScenarioType);
    }
}
