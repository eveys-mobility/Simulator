import * as fs from 'fs';
import * as path from 'path';

interface ActiveTransaction {
    connectorId: number;
    transactionId: number;
    idTag: string;
    startTime: Date;
    startMeterValue: number;
    isRemoteStart: boolean;
}

export class TransactionTracker {
    private chargePointId: string;
    private dataDir: string;
    private trackerFile: string;
    private activeTransactions: Map<number, ActiveTransaction> = new Map();

    constructor(chargePointId: string) {
        this.chargePointId = chargePointId;
        this.dataDir = path.join(process.cwd(), 'data');
        this.trackerFile = path.join(this.dataDir, `transactions_${chargePointId}.json`);

        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Load existing transactions
        this.loadTransactions();
    }

    /**
     * Register a started transaction
     */
    public registerTransaction(
        connectorId: number,
        transactionId: number,
        idTag: string,
        startMeterValue: number,
        isRemoteStart: boolean
    ): void {
        const transaction: ActiveTransaction = {
            connectorId,
            transactionId,
            idTag,
            startTime: new Date(),
            startMeterValue,
            isRemoteStart
        };

        this.activeTransactions.set(connectorId, transaction);
        this.saveTransactions();

        console.log(`[TransactionTracker] Registered transaction ${transactionId} on connector ${connectorId}`);
    }

    /**
     * Unregister a stopped transaction
     */
    public unregisterTransaction(connectorId: number): void {
        const transaction = this.activeTransactions.get(connectorId);
        if (transaction) {
            console.log(`[TransactionTracker] Unregistered transaction ${transaction.transactionId} on connector ${connectorId}`);
            this.activeTransactions.delete(connectorId);
            this.saveTransactions();
        }
    }

    /**
     * Get active transaction for a connector
     */
    public getActiveTransaction(connectorId: number): ActiveTransaction | undefined {
        return this.activeTransactions.get(connectorId);
    }

    /**
     * Check if connector has active transaction
     */
    public hasActiveTransaction(connectorId: number): boolean {
        return this.activeTransactions.has(connectorId);
    }

    /**
     * Get all active transactions
     */
    public getAllActiveTransactions(): ActiveTransaction[] {
        return Array.from(this.activeTransactions.values());
    }

    /**
     * Get count of active transactions
     */
    public getActiveCount(): number {
        return this.activeTransactions.size;
    }

    /**
     * Load transactions from file
     */
    private loadTransactions(): void {
        try {
            if (fs.existsSync(this.trackerFile)) {
                const data = fs.readFileSync(this.trackerFile, 'utf-8');
                const transactions: ActiveTransaction[] = JSON.parse(data);

                transactions.forEach(tx => {
                    // Convert date strings back to Date objects
                    tx.startTime = new Date(tx.startTime);
                    this.activeTransactions.set(tx.connectorId, tx);
                });

                if (transactions.length > 0) {
                    console.log(`[TransactionTracker] Loaded ${transactions.length} active transactions from file`);
                    console.warn(`[TransactionTracker] WARNING: Found ${transactions.length} transactions that were not properly stopped!`);
                    transactions.forEach(tx => {
                        console.warn(`  - Connector ${tx.connectorId}, Transaction ${tx.transactionId}, Started: ${tx.startTime}`);
                    });
                }
            } else {
                console.log('[TransactionTracker] No existing transaction tracker file found');
            }
        } catch (error) {
            console.error('[TransactionTracker] Error loading transactions:', error);
            this.activeTransactions.clear();
        }
    }

    /**
     * Save transactions to file
     */
    private saveTransactions(): void {
        try {
            const transactions = Array.from(this.activeTransactions.values());
            fs.writeFileSync(this.trackerFile, JSON.stringify(transactions, null, 2), 'utf-8');
        } catch (error) {
            console.error('[TransactionTracker] Error saving transactions:', error);
        }
    }

    /**
     * Clear all transactions (use with caution)
     */
    public clearAll(): void {
        this.activeTransactions.clear();
        this.saveTransactions();
        console.log('[TransactionTracker] All transactions cleared');
    }
}
