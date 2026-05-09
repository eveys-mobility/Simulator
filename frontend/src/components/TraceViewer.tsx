import React, { useEffect, useRef, useState } from 'react';
import { Activity, Download } from 'lucide-react';

export type TraceLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TraceEntry {
    ts: string;
    level: TraceLevel;
    component: string;
    event: string;
    cp_id?: string;
    [key: string]: any;
}

interface TraceViewerProps {
    traces: TraceEntry[];
}

const LEVEL_COLORS: Record<TraceLevel, string> = {
    debug: '#6b7280',
    info: '#3b82f6',
    warn: '#f59e0b',
    error: '#ef4444',
};

const LEVEL_ORDER: TraceLevel[] = ['debug', 'info', 'warn', 'error'];

export const TraceViewer: React.FC<TraceViewerProps> = ({ traces }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [minLevel, setMinLevel] = useState<TraceLevel>('info');
    const [filter, setFilter] = useState('');

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [traces]);

    const minRank = LEVEL_ORDER.indexOf(minLevel);
    const visible = traces.filter((t) => {
        if (LEVEL_ORDER.indexOf(t.level) < minRank) return false;
        if (!filter) return true;
        const haystack = `${t.component} ${t.event} ${JSON.stringify(t)}`.toLowerCase();
        return haystack.includes(filter.toLowerCase());
    });

    const renderFields = (entry: TraceEntry): string => {
        const { ts, level, component, event, cp_id, ...rest } = entry;
        if (Object.keys(rest).length === 0) return '';
        return JSON.stringify(rest, null, 0);
    };

    const downloadTraces = () => {
        const text = traces.map((t) => JSON.stringify(t)).join('\n');
        const blob = new Blob([text], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ocpp-traces-${new Date().toISOString()}.ndjson`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
                <h2 className="card-title">
                    <Activity size={24} />
                    Trace ({visible.length}/{traces.length})
                </h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                        value={minLevel}
                        onChange={(e) => setMinLevel(e.target.value as TraceLevel)}
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '4px' }}
                    >
                        <option value="debug">debug+</option>
                        <option value="info">info+</option>
                        <option value="warn">warn+</option>
                        <option value="error">error only</option>
                    </select>
                    <input
                        type="text"
                        placeholder="filter…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', minWidth: '160px' }}
                    />
                    <button className="btn btn-secondary" onClick={downloadTraces} disabled={traces.length === 0}>
                        <Download size={18} />
                        Export
                    </button>
                </div>
            </div>
            <div className="card-body">
                <div className="log-container" ref={containerRef}>
                    {visible.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            No traces match the current filters.
                        </div>
                    ) : (
                        visible.map((t, index) => {
                            const fields = renderFields(t);
                            return (
                                <div key={index} className="log-entry" style={{ borderLeft: `3px solid ${LEVEL_COLORS[t.level]}` }}>
                                    <div className="log-timestamp">
                                        <span style={{ color: LEVEL_COLORS[t.level], fontWeight: 700, marginRight: '0.5rem', textTransform: 'uppercase' }}>
                                            {t.level}
                                        </span>
                                        <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>
                                            {new Date(t.ts).toLocaleTimeString()}
                                        </span>
                                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                            {t.component}.{t.event}
                                        </span>
                                    </div>
                                    {fields && (
                                        <div className="log-data">
                                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85em' }}>
                                                {fields}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};
