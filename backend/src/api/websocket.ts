import WebSocket from 'ws';
import { Server as HTTPServer } from 'http';

export interface OCPPLogMessage {
    timestamp: Date;
    direction: 'incoming' | 'outgoing';
    data: any;
}

export interface TraceEntry {
    ts: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    component: string;
    event: string;
    cp_id?: string;
    [key: string]: any;
}

export class WebSocketServer {
    private wss: WebSocket.Server;
    private clients: Set<WebSocket> = new Set();
    private messageLog: OCPPLogMessage[] = [];
    private traceLog: TraceEntry[] = [];
    private maxLogSize: number = 1000;
    private maxTraceSize: number = 2000;

    constructor(server: HTTPServer) {
        this.wss = new WebSocket.Server({ server, path: '/ws' });

        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[WebSocketServer] Client connected');
            this.clients.add(ws);

            // Send existing logs to new client
            ws.send(JSON.stringify({
                type: 'logs',
                data: this.messageLog
            }));

            // Replay the trace buffer so a freshly-opened UI lands on
            // the latest events instead of waiting for the next one.
            ws.send(JSON.stringify({
                type: 'traces',
                data: this.traceLog
            }));

            ws.on('close', () => {
                console.log('[WebSocketServer] Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('[WebSocketServer] WebSocket error:', error);
                this.clients.delete(ws);
            });
        });
    }

    public broadcastStatus(status: any): void {
        this.broadcast({
            type: 'status',
            data: status
        });
    }

    public broadcastSession(session: any): void {
        this.broadcast({
            type: 'session',
            data: session
        });
    }

    public broadcastLog(log: OCPPLogMessage): void {
        // Add to log history
        this.messageLog.push(log);

        // Trim log if too large
        if (this.messageLog.length > this.maxLogSize) {
            this.messageLog = this.messageLog.slice(-this.maxLogSize);
        }

        this.broadcast({
            type: 'log',
            data: log
        });
    }

    public broadcastEvent(event: string, data: any): void {
        this.broadcast({
            type: 'event',
            event,
            data
        });
    }

    public broadcastTrace(entry: TraceEntry): void {
        this.traceLog.push(entry);
        if (this.traceLog.length > this.maxTraceSize) {
            this.traceLog = this.traceLog.slice(-this.maxTraceSize);
        }
        this.broadcast({
            type: 'trace',
            data: entry
        });
    }

    public getTraceLog(): TraceEntry[] {
        return [...this.traceLog];
    }

    private broadcast(message: any): void {
        const messageStr = JSON.stringify(message);

        this.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    public getMessageLog(): OCPPLogMessage[] {
        return [...this.messageLog];
    }

    public clearMessageLog(): void {
        this.messageLog = [];
        this.broadcast({
            type: 'logs',
            data: []
        });
    }
}
