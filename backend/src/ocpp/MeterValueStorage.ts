import * as fs from 'fs';
import * as path from 'path';

interface MeterState {
    chargePointId: string;
    connectorId: number;
    currentMeterValue: number; // in Wh
    lastUpdated: Date;
}

export class MeterValueStorage {
    private chargePointId: string;
    private dataDir: string;
    private meterFile: string;
    private meterStates: Map<number, number> = new Map(); // connectorId -> meterValue

    constructor(chargePointId: string) {
        this.chargePointId = chargePointId;
        this.dataDir = path.join(process.cwd(), 'data');
        this.meterFile = path.join(this.dataDir, `meter_${chargePointId}.json`);

        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Load existing meter values
        this.loadMeterValues();
    }

    /**
     * Get current meter value for a connector
     */
    public getMeterValue(connectorId: number): number {
        return this.meterStates.get(connectorId) || 0;
    }

    /**
     * Increment meter value for a connector
     * @param connectorId Connector ID
     * @param incrementWh Energy increment in Wh
     * @returns New meter value
     */
    public incrementMeterValue(connectorId: number, incrementWh: number): number {
        const currentValue = this.getMeterValue(connectorId);
        const newValue = currentValue + incrementWh;

        this.meterStates.set(connectorId, newValue);
        this.saveMeterValues();

        return newValue;
    }

    /**
     * Set meter value directly (use with caution - only for manual testing)
     */
    public setMeterValue(connectorId: number, valueWh: number): void {
        this.meterStates.set(connectorId, valueWh);
        this.saveMeterValues();
    }

    /**
     * Get all meter states
     */
    public getAllMeterStates(): Map<number, number> {
        return new Map(this.meterStates);
    }

    /**
     * Load meter values from file
     */
    private loadMeterValues(): void {
        try {
            if (fs.existsSync(this.meterFile)) {
                const data = fs.readFileSync(this.meterFile, 'utf-8');
                const states: MeterState[] = JSON.parse(data);

                states.forEach(state => {
                    this.meterStates.set(state.connectorId, state.currentMeterValue);
                });

                console.log(`[MeterValueStorage] Loaded meter values for ${states.length} connectors`);
                states.forEach(state => {
                    console.log(`  Connector ${state.connectorId}: ${state.currentMeterValue} Wh`);
                });
            } else {
                console.log('[MeterValueStorage] No existing meter file found, starting from zero');
            }
        } catch (error) {
            console.error('[MeterValueStorage] Error loading meter values:', error);
            this.meterStates.clear();
        }
    }

    /**
     * Save meter values to file
     */
    private saveMeterValues(): void {
        try {
            const states: MeterState[] = [];

            this.meterStates.forEach((meterValue, connectorId) => {
                states.push({
                    chargePointId: this.chargePointId,
                    connectorId,
                    currentMeterValue: meterValue,
                    lastUpdated: new Date()
                });
            });

            fs.writeFileSync(this.meterFile, JSON.stringify(states, null, 2), 'utf-8');
        } catch (error) {
            console.error('[MeterValueStorage] Error saving meter values:', error);
        }
    }

    /**
     * Get statistics
     */
    public getStats(): {
        totalConnectors: number;
        totalEnergy: number;
        byConnector: Array<{ connectorId: number; meterValue: number }>;
    } {
        const byConnector: Array<{ connectorId: number; meterValue: number }> = [];
        let totalEnergy = 0;

        this.meterStates.forEach((meterValue, connectorId) => {
            byConnector.push({ connectorId, meterValue });
            totalEnergy += meterValue;
        });

        return {
            totalConnectors: this.meterStates.size,
            totalEnergy,
            byConnector
        };
    }
}
