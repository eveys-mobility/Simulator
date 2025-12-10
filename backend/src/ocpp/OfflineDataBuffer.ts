import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface BufferedMessage {
    id: string;
    type: 'StartTransaction' | 'StopTransaction' | 'MeterValues' | 'StatusNotification';
    timestamp: Date;
    payload: any;
    retries: number;
    connectorId?: number;
    transactionId?: number;
}

interface BufferStorage {
    chargePointId: string;
    lastSync: Date | null;
    messages: BufferedMessage[];
}

export class OfflineDataBuffer extends EventEmitter {
    private chargePointId: string;
    private buffer: BufferedMessage[] = [];
    private bufferFile: string;
    private dataDir: string;

    constructor(chargePointId: string) {
        super();
        this.chargePointId = chargePointId;
        this.dataDir = path.join(process.cwd(), 'data');
        this.bufferFile = path.join(this.dataDir, `offline_buffer_${chargePointId}.json`);

        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Load existing buffer from file
        this.loadBuffer();
    }

    /**
     * Add a message to the offline buffer
     */
    public addMessage(
        type: BufferedMessage['type'],
        payload: any,
        connectorId?: number,
        transactionId?: number
    ): void {
        const message: BufferedMessage = {
            id: this.generateMessageId(),
            type,
            timestamp: new Date(),
            payload,
            retries: 0,
            connectorId,
            transactionId
        };

        this.buffer.push(message);
        this.saveBuffer();

        console.log(`[OfflineDataBuffer] Added ${type} message to buffer (total: ${this.buffer.length})`);
        this.emit('messageAdded', message);
    }

    /**
     * Get all buffered messages
     */
    public getMessages(): BufferedMessage[] {
        return [...this.buffer];
    }

    /**
     * Get count of buffered messages
     */
    public getMessageCount(): number {
        return this.buffer.length;
    }

    /**
     * Remove a message from the buffer by ID
     */
    public removeMessage(messageId: string): void {
        const index = this.buffer.findIndex(m => m.id === messageId);
        if (index !== -1) {
            this.buffer.splice(index, 1);
            this.saveBuffer();
            console.log(`[OfflineDataBuffer] Removed message ${messageId} (remaining: ${this.buffer.length})`);
        }
    }

    /**
     * Increment retry count for a message
     */
    public incrementRetry(messageId: string): void {
        const message = this.buffer.find(m => m.id === messageId);
        if (message) {
            message.retries++;
            this.saveBuffer();
        }
    }

    /**
     * Clear all messages from buffer
     */
    public clearBuffer(): void {
        this.buffer = [];
        this.saveBuffer();
        console.log('[OfflineDataBuffer] Buffer cleared');
        this.emit('bufferCleared');
    }

    /**
     * Check if buffer is empty
     */
    public isEmpty(): boolean {
        return this.buffer.length === 0;
    }

    /**
     * Load buffer from file
     */
    private loadBuffer(): void {
        try {
            if (fs.existsSync(this.bufferFile)) {
                const data = fs.readFileSync(this.bufferFile, 'utf-8');
                const storage: BufferStorage = JSON.parse(data);

                // Convert timestamp strings back to Date objects
                this.buffer = storage.messages.map(msg => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp)
                }));

                console.log(`[OfflineDataBuffer] Loaded ${this.buffer.length} messages from buffer file`);
            } else {
                console.log('[OfflineDataBuffer] No existing buffer file found, starting fresh');
            }
        } catch (error) {
            console.error('[OfflineDataBuffer] Error loading buffer:', error);
            this.buffer = [];
        }
    }

    /**
     * Save buffer to file
     */
    private saveBuffer(): void {
        try {
            const storage: BufferStorage = {
                chargePointId: this.chargePointId,
                lastSync: this.buffer.length > 0 ? new Date() : null,
                messages: this.buffer
            };

            fs.writeFileSync(this.bufferFile, JSON.stringify(storage, null, 2), 'utf-8');
        } catch (error) {
            console.error('[OfflineDataBuffer] Error saving buffer:', error);
        }
    }

    /**
     * Generate unique message ID
     */
    private generateMessageId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get buffer statistics
     */
    public getStats(): {
        totalMessages: number;
        byType: Record<string, number>;
        oldestMessage: Date | null;
        newestMessage: Date | null;
    } {
        const byType: Record<string, number> = {};

        this.buffer.forEach(msg => {
            byType[msg.type] = (byType[msg.type] || 0) + 1;
        });

        const timestamps = this.buffer.map(m => m.timestamp.getTime());

        return {
            totalMessages: this.buffer.length,
            byType,
            oldestMessage: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
            newestMessage: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null
        };
    }
}
