import express, { Request, Response } from 'express';
import { ChargePoint } from '../ocpp/ChargePoint';
import { TransactionManager } from '../ocpp/TransactionManager';
import { ScenarioEngine, ScenarioType } from '../simulation/ScenarioEngine';

export function createApiRoutes(
    chargePoint: ChargePoint,
    transactionManager: TransactionManager,
    scenarioEngine: ScenarioEngine
) {
    const router = express.Router();

    // Get current status
    router.get('/status', (req: Request, res: Response) => {
        const sessions = transactionManager.getAllSessions();

        res.json({
            connected: chargePoint.isConnectedToServer(),
            sessions: sessions.map(session => ({
                connectorId: session.connectorId,
                transactionId: session.transactionId,
                idTag: session.idTag,
                status: session.status,
                powerKw: session.powerKw,
                energyKwh: session.energyKwh,
                duration: session.duration,
                startTime: session.startTime
            })),
            connectors: [
                {
                    id: 1,
                    status: chargePoint.getConnectorStatus(1),
                    hasActiveSession: transactionManager.hasActiveSession(1)
                }
            ]
        });
    });

    // Get transaction history
    router.get('/history', (req: Request, res: Response) => {
        const count = parseInt(req.query.count as string) || 10;
        const transactions = transactionManager.getLastTransactions(count);
        const stats = transactionManager.getHistoryStatistics();

        res.json({
            success: true,
            transactions,
            statistics: stats
        });
    });

    // Get transaction history statistics
    router.get('/history/stats', (req: Request, res: Response) => {
        const stats = transactionManager.getHistoryStatistics();
        res.json({
            success: true,
            statistics: stats
        });
    });

    // Connect to OCPP server
    router.post('/connect', async (req: Request, res: Response) => {
        try {
            await chargePoint.connect();
            res.json({ success: true, message: 'Connected to OCPP server' });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Disconnect from OCPP server
    router.post('/disconnect', (req: Request, res: Response) => {
        try {
            chargePoint.disconnect();
            res.json({ success: true, message: 'Disconnected from OCPP server' });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Start charging
    router.post('/start-charging', async (req: Request, res: Response) => {
        try {
            const { connectorId = 1, idTag = 'TEST-TAG-001' } = req.body;

            // Local start via API - use local transaction ID (isRemoteStart = false)
            const session = await transactionManager.startTransaction(connectorId, idTag, false);

            res.json({
                success: true,
                message: 'Charging started',
                session
            });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Stop charging
    router.post('/stop-charging', async (req: Request, res: Response) => {
        try {
            const { connectorId = 1, reason = 'Local' } = req.body;

            await transactionManager.stopTransaction(connectorId, reason);

            res.json({
                success: true,
                message: 'Charging stopped'
            });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Pause charging
    router.post('/pause-charging', async (req: Request, res: Response) => {
        try {
            const { connectorId = 1 } = req.body;

            await transactionManager.pauseTransaction(connectorId);

            res.json({
                success: true,
                message: 'Charging paused'
            });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Resume charging
    router.post('/resume-charging', async (req: Request, res: Response) => {
        try {
            const { connectorId = 1 } = req.body;

            await transactionManager.resumeTransaction(connectorId);

            res.json({
                success: true,
                message: 'Charging resumed'
            });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Execute scenario
    router.post('/simulate-scenario', async (req: Request, res: Response) => {
        try {
            const { scenario, connectorId = 1 } = req.body;

            if (!scenario || !Object.values(ScenarioType).includes(scenario)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid scenario type',
                    availableScenarios: Object.values(ScenarioType)
                });
            }

            const result = await scenarioEngine.executeScenario(scenario as ScenarioType, connectorId);

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Get available scenarios
    router.get('/scenarios', (req: Request, res: Response) => {
        res.json({
            scenarios: scenarioEngine.getAvailableScenarios()
        });
    });

    // Get OCPP configuration
    router.get('/config', (req: Request, res: Response) => {
        const configuration = chargePoint.getConfiguration();
        res.json({
            configuration,
            count: configuration.length
        });
    });

    // Update OCPP configuration (for testing - normally done via OCPP ChangeConfiguration)
    router.post('/config', async (req: Request, res: Response) => {
        try {
            const { key, value } = req.body;

            if (!key || value === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'key and value are required'
                });
            }

            // Get the configuration manager
            const configManager = chargePoint.getConfigurationManager();

            // Get current value before update
            const currentConfig = chargePoint.getConfiguration().find(c => c.key === key);
            if (!currentConfig) {
                return res.status(404).json({
                    success: false,
                    message: 'Configuration key not found'
                });
            }

            const oldValue = currentConfig.value;

            // Update the configuration
            const status = configManager.changeConfiguration(key, value);

            // Map status to HTTP response
            switch (status) {
                case 'Accepted':
                    res.json({
                        success: true,
                        message: 'Configuration updated successfully',
                        key,
                        oldValue,
                        newValue: value,
                        status
                    });
                    break;

                case 'Rejected':
                    res.status(403).json({
                        success: false,
                        message: 'Configuration key is readonly',
                        status
                    });
                    break;

                case 'RebootRequired':
                    res.json({
                        success: true,
                        message: 'Configuration updated. Reboot required for changes to take effect.',
                        key,
                        oldValue,
                        newValue: value,
                        status
                    });
                    break;

                case 'NotSupported':
                    res.status(404).json({
                        success: false,
                        message: 'Configuration key not supported',
                        status
                    });
                    break;

                default:
                    res.status(500).json({
                        success: false,
                        message: 'Unknown status returned',
                        status
                    });
            }
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Send heartbeat manually
    router.post('/heartbeat', async (req: Request, res: Response) => {
        try {
            const result = await chargePoint.sendHeartbeat();
            res.json({ success: true, result });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Authorize ID tag
    router.post('/authorize', async (req: Request, res: Response) => {
        try {
            const { idTag } = req.body;

            if (!idTag) {
                return res.status(400).json({ success: false, message: 'idTag is required' });
            }

            const result = await chargePoint.sendAuthorize(idTag);
            res.json({ success: true, result });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Send DataTransfer
    router.post('/data-transfer', async (req: Request, res: Response) => {
        try {
            const { vendorId, messageId, data } = req.body;

            if (!vendorId) {
                return res.status(400).json({ success: false, message: 'vendorId is required' });
            }

            const result = await chargePoint.sendDataTransfer(vendorId, messageId, data);
            res.json({ success: true, result });
        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Manual consumption testing
    router.post('/manual-consumption', async (req: Request, res: Response) => {
        try {
            const { energyWh, mode, splitCount } = req.body;

            if (!energyWh || energyWh <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid energy value'
                });
            }

            // Get active session
            const sessions = transactionManager.getAllSessions();
            const activeSession = sessions.find(s => s.status === 'Charging');

            if (!activeSession) {
                return res.status(400).json({
                    success: false,
                    message: 'No active charging session'
                });
            }

            if (mode === 'single') {
                // Increment the persistent meter value
                const newMeterValue = transactionManager['meterStorage'].incrementMeterValue(activeSession.connectorId, energyWh);

                // Update session with latest values
                activeSession.currentMeterValue = newMeterValue;
                activeSession.energyKwh = (newMeterValue - activeSession.startMeterValue) / 1000;

                // Build complete meter value with all measurands (matching real-time schema)
                const configManager = chargePoint.getConfigurationManager();
                const measurandsConfig = configManager.getValue('MeterValuesSampledData') ||
                    'Energy.Active.Import.Register,Power.Active.Import';
                const measurands = measurandsConfig.split(',').map(m => m.trim());

                const sampledValue: any[] = [];

                // Add each configured measurand
                if (measurands.includes('Energy.Active.Import.Register')) {
                    sampledValue.push({
                        value: newMeterValue.toString(),
                        context: 'Sample.Periodic',
                        measurand: 'Energy.Active.Import.Register',
                        unit: 'Wh'
                    });
                }

                if (measurands.includes('Power.Active.Import')) {
                    const powerW = activeSession.powerKw * 1000;
                    sampledValue.push({
                        value: powerW.toString(),
                        context: 'Sample.Periodic',
                        measurand: 'Power.Active.Import',
                        unit: 'W'
                    });
                }

                if (measurands.includes('Current.Import')) {
                    const current = (activeSession.powerKw * 1000) / 230; // I = P/V
                    sampledValue.push({
                        value: current.toFixed(1),
                        context: 'Sample.Periodic',
                        measurand: 'Current.Import',
                        unit: 'A',
                        phase: 'L1'
                    });
                }

                if (measurands.includes('Voltage')) {
                    sampledValue.push({
                        value: '230',
                        context: 'Sample.Periodic',
                        measurand: 'Voltage',
                        unit: 'V',
                        phase: 'L1'
                    });
                }

                const meterValue = [{
                    timestamp: new Date().toISOString(),
                    sampledValue
                }];

                await chargePoint.sendMeterValues(
                    activeSession.connectorId,
                    activeSession.transactionId!,
                    meterValue
                );

                res.json({
                    success: true,
                    message: `Sent ${energyWh} Wh in single message`,
                    totalEnergy: newMeterValue,
                    sessionEnergy: activeSession.energyKwh,
                    measurands: sampledValue.length
                });

            } else if (mode === 'split') {
                // Split energy across multiple messages
                const parts = parseInt(splitCount) || 5;
                const energyPerPart = Math.floor(energyWh / parts);
                let sentMessages = 0;
                let finalMeterValue = 0;

                // Get configured measurands
                const configManager = chargePoint.getConfigurationManager();
                const measurandsConfig = configManager.getValue('MeterValuesSampledData') ||
                    'Energy.Active.Import.Register,Power.Active.Import';
                const measurands = measurandsConfig.split(',').map(m => m.trim());

                for (let i = 0; i < parts; i++) {
                    const partEnergy = (i === parts - 1)
                        ? energyWh - (energyPerPart * (parts - 1)) // Last part gets remainder
                        : energyPerPart;

                    // Increment persistent storage
                    const newMeterValue = transactionManager['meterStorage'].incrementMeterValue(activeSession.connectorId, partEnergy);
                    finalMeterValue = newMeterValue;

                    // Update session
                    activeSession.currentMeterValue = newMeterValue;
                    activeSession.energyKwh = (newMeterValue - activeSession.startMeterValue) / 1000;

                    // Build complete meter value with all measurands
                    const sampledValue: any[] = [];

                    if (measurands.includes('Energy.Active.Import.Register')) {
                        sampledValue.push({
                            value: newMeterValue.toString(),
                            context: 'Sample.Periodic',
                            measurand: 'Energy.Active.Import.Register',
                            unit: 'Wh'
                        });
                    }

                    if (measurands.includes('Power.Active.Import')) {
                        const powerW = activeSession.powerKw * 1000;
                        sampledValue.push({
                            value: powerW.toString(),
                            context: 'Sample.Periodic',
                            measurand: 'Power.Active.Import',
                            unit: 'W'
                        });
                    }

                    if (measurands.includes('Current.Import')) {
                        const current = (activeSession.powerKw * 1000) / 230;
                        sampledValue.push({
                            value: current.toFixed(1),
                            context: 'Sample.Periodic',
                            measurand: 'Current.Import',
                            unit: 'A',
                            phase: 'L1'
                        });
                    }

                    if (measurands.includes('Voltage')) {
                        sampledValue.push({
                            value: '230',
                            context: 'Sample.Periodic',
                            measurand: 'Voltage',
                            unit: 'V',
                            phase: 'L1'
                        });
                    }

                    const meterValue = [{
                        timestamp: new Date().toISOString(),
                        sampledValue
                    }];

                    await chargePoint.sendMeterValues(
                        activeSession.connectorId,
                        activeSession.transactionId!,
                        meterValue
                    );

                    sentMessages++;

                    // Small delay between messages
                    if (i < parts - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                res.json({
                    success: true,
                    message: `Sent ${energyWh} Wh split across ${sentMessages} messages`,
                    totalEnergy: finalMeterValue,
                    sessionEnergy: activeSession.energyKwh,
                    measurands: measurands.length
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Invalid mode. Use "single" or "split"'
                });
            }

        } catch (error: any) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
}
