import * as fs from 'fs';
import * as path from 'path';

export interface TransactionRecord {
    transactionId: number;
    connectorId: number;
    idTag: string;
    startTime: Date;
    stopTime?: Date;
    startMeterValue: number;
    stopMeterValue?: number;
    energyConsumed?: number; // kWh
    duration?: number; // seconds
    stopReason?: string;
    isRemoteStart: boolean;
    status: 'active' | 'completed';
}

export class TransactionHistory {
    private chargePointId: string;
    private dataDir: string;
    private historyFile: string;
    private maxRecords: number;
    private transactions: TransactionRecord[] = [];

    constructor(chargePointId: string, maxRecords: number = 50) {
        this.chargePointId = chargePointId;
        this.maxRecords = maxRecords;
        this.dataDir = path.join(process.cwd(), 'data');
        this.historyFile = path.join(this.dataDir, `transaction_history_${chargePointId}.json`);

        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Load existing history
        this.loadHistory();
    }

    /**
     * Add a started transaction to history
     */
    public addStartedTransaction(
        transactionId: number,
        connectorId: number,
        idTag: string,
        startMeterValue: number,
        isRemoteStart: boolean
    ): void {
        const record: TransactionRecord = {
            transactionId,
            connectorId,
            idTag,
            startTime: new Date(),
            startMeterValue,
            isRemoteStart,
            status: 'active'
        };

        this.transactions.unshift(record); // Add to beginning
        this.trimHistory();
        this.saveHistory();

        console.log(`[TransactionHistory] Recorded transaction start: ${transactionId}`);
    }

    /**
     * Complete a transaction with stop details
     */
    public completeTransaction(
        transactionId: number,
        stopMeterValue: number,
        stopReason: string
    ): void {
        const record = this.transactions.find(t => t.transactionId === transactionId);

        if (record) {
            record.stopTime = new Date();
            record.stopMeterValue = stopMeterValue;
            record.energyConsumed = (stopMeterValue - record.startMeterValue) / 1000; // Wh to kWh
            record.duration = Math.floor((record.stopTime.getTime() - record.startTime.getTime()) / 1000);
            record.stopReason = stopReason;
            record.status = 'completed';

            this.saveHistory();

            console.log(`[TransactionHistory] Completed transaction ${transactionId}: ${record.energyConsumed?.toFixed(2)} kWh, ${record.duration}s`);
        } else {
            console.warn(`[TransactionHistory] Transaction ${transactionId} not found in history`);
        }
    }

    /**
     * Get transaction by ID
     */
    public getTransaction(transactionId: number): TransactionRecord | undefined {
        return this.transactions.find(t => t.transactionId === transactionId);
    }

    /**
     * Get last N transactions
     */
    public getLastTransactions(count: number = 10): TransactionRecord[] {
        return this.transactions.slice(0, count);
    }

    /**
     * Get all transactions
     */
    public getAllTransactions(): TransactionRecord[] {
        return [...this.transactions];
    }

    /**
     * Get active (not completed) transactions
     */
    public getActiveTransactions(): TransactionRecord[] {
        return this.transactions.filter(t => t.status === 'active');
    }

    /**
     * Get completed transactions
     */
    public getCompletedTransactions(): TransactionRecord[] {
        return this.transactions.filter(t => t.status === 'completed');
    }

    /**
     * Get statistics
     */
    public getStatistics(): {
        totalTransactions: number;
        activeTransactions: number;
        completedTransactions: number;
        totalEnergyConsumed: number; // kWh
        averageEnergyPerTransaction: number; // kWh
        averageDuration: number; // seconds
    } {
        const completed = this.getCompletedTransactions();
        const totalEnergy = completed.reduce((sum, t) => sum + (t.energyConsumed || 0), 0);
        const totalDuration = completed.reduce((sum, t) => sum + (t.duration || 0), 0);

        return {
            totalTransactions: this.transactions.length,
            activeTransactions: this.getActiveTransactions().length,
            completedTransactions: completed.length,
            totalEnergyConsumed: totalEnergy,
            averageEnergyPerTransaction: completed.length > 0 ? totalEnergy / completed.length : 0,
            averageDuration: completed.length > 0 ? totalDuration / completed.length : 0
        };
    }

    /**
     * Clear all history (use with caution)
     */
    public clearHistory(): void {
        this.transactions = [];
        this.saveHistory();
        console.log('[TransactionHistory] History cleared');
    }

    /**
     * Trim history to max records
     */
    private trimHistory(): void {
        if (this.transactions.length > this.maxRecords) {
            this.transactions = this.transactions.slice(0, this.maxRecords);
            console.log(`[TransactionHistory] Trimmed history to ${this.maxRecords} records`);
        }
    }

    /**
     * Load history from file
     */
    private loadHistory(): void {
        try {
            if (fs.existsSync(this.historyFile)) {
                const data = fs.readFileSync(this.historyFile, 'utf-8');
                const records: TransactionRecord[] = JSON.parse(data);

                // Convert date strings back to Date objects
                this.transactions = records.map(record => ({
                    ...record,
                    startTime: new Date(record.startTime),
                    stopTime: record.stopTime ? new Date(record.stopTime) : undefined
                }));

                console.log(`[TransactionHistory] Loaded ${this.transactions.length} transaction records`);

                // Log statistics
                const stats = this.getStatistics();
                console.log(`[TransactionHistory] Statistics: ${stats.completedTransactions} completed, ${stats.activeTransactions} active, ${stats.totalEnergyConsumed.toFixed(2)} kWh total`);
            } else {
                console.log('[TransactionHistory] No existing history file found');
            }
        } catch (error) {
            console.error('[TransactionHistory] Error loading history:', error);
            this.transactions = [];
        }
    }

    /**
     * Save history to file
     */
    private saveHistory(): void {
        try {
            fs.writeFileSync(this.historyFile, JSON.stringify(this.transactions, null, 2), 'utf-8');
        } catch (error) {
            console.error('[TransactionHistory] Error saving history:', error);
        }
    }
}
