import React, { useEffect, useRef } from 'react';
import { FileText, Download } from 'lucide-react';

interface LogEntry {
    timestamp: Date;
    direction: 'incoming' | 'outgoing';
    data: any;
}

interface LogsViewerProps {
    logs: LogEntry[];
}

export const LogsViewer: React.FC<LogsViewerProps> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const formatMessage = (data: any): string => {
        if (Array.isArray(data)) {
            const [messageType, uniqueId, ...rest] = data;
            const messageTypeNames = { 2: 'CALL', 3: 'CALLRESULT', 4: 'CALLERROR' };
            const typeName = messageTypeNames[messageType as keyof typeof messageTypeNames] || messageType;

            if (messageType === 2) {
                const [action, payload] = rest;
                return `[${typeName}] ${action}\n${JSON.stringify(payload, null, 2)}`;
            } else if (messageType === 3) {
                return `[${typeName}]\n${JSON.stringify(rest[0], null, 2)}`;
            } else if (messageType === 4) {
                return `[${typeName}] ${rest[0]}: ${rest[1]}`;
            }
        }
        return JSON.stringify(data, null, 2);
    };

    const downloadLogs = () => {
        const logsText = logs.map(log =>
            `[${new Date(log.timestamp).toISOString()}] ${log.direction.toUpperCase()}\n${formatMessage(log.data)}\n---\n`
        ).join('\n');

        const blob = new Blob([logsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ocpp-logs-${new Date().toISOString()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
                <h2 className="card-title">
                    <FileText size={24} />
                    OCPP Message Logs
                </h2>
                <button className="btn btn-secondary" onClick={downloadLogs} disabled={logs.length === 0}>
                    <Download size={18} />
                    Export
                </button>
            </div>
            <div className="card-body">
                <div className="log-container" ref={logContainerRef}>
                    {logs.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            No messages yet. Connect to OCPP server to see logs.
                        </div>
                    ) : (
                        logs.map((log, index) => (
                            <div key={index} className={`log-entry ${log.direction}`}>
                                <div className="log-timestamp">
                                    <span style={{
                                        color: log.direction === 'incoming' ? 'var(--accent-success)' : 'var(--accent-primary)',
                                        fontWeight: 600,
                                        marginRight: '0.5rem'
                                    }}>
                                        {log.direction === 'incoming' ? '← IN' : '→ OUT'}
                                    </span>
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                </div>
                                <div className="log-data">
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {formatMessage(log.data)}
                                    </pre>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
