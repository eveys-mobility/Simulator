import React from 'react';
import { Square } from 'lucide-react';
import { fleetApi, FleetSession } from './fleet-api';

interface ActiveSessionsTableProps {
    sessions: FleetSession[];
    onAction: (msg: string) => void;
    onMutate: () => void;
}

const formatDuration = (startedAt: string): string => {
    const start = new Date(startedAt).getTime();
    const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m}m${s.toString().padStart(2, '0')}s`;
};

export const ActiveSessionsTable: React.FC<ActiveSessionsTableProps> = ({ sessions, onAction, onMutate }) => {
    const handleStop = async (cp_id: string, connector_id: number): Promise<void> => {
        try {
            await fleetApi.stopCharging(cp_id, connector_id);
            onAction(`stop sent to ${cp_id} c${connector_id}`);
            onMutate();
        } catch (err: any) {
            onAction(`stop failed: ${err.message}`);
        }
    };

    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">Active sessions ({sessions.length})</h2>
            </div>
            <div className="card-body">
                {sessions.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                        No active sessions.
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--bg-tertiary)' }}>
                                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>tx_id</th>
                                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>cp_id</th>
                                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>connector</th>
                                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>id_tag</th>
                                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>since</th>
                                    <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem' }}>energy</th>
                                    <th style={{ padding: '0.4rem 0.6rem' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((s) => (
                                    <tr key={s.id} style={{ borderBottom: '1px solid var(--bg-tertiary)' }}>
                                        <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace' }}>{s.id}</td>
                                        <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace' }}>{s.cp_id}</td>
                                        <td style={{ padding: '0.4rem 0.6rem' }}>{s.connector_id}</td>
                                        <td style={{ padding: '0.4rem 0.6rem' }}>{s.id_tag}</td>
                                        <td style={{ padding: '0.4rem 0.6rem' }}>{formatDuration(s.started_at)}</td>
                                        <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                                            {(s.energy_wh / 1000).toFixed(2)} kWh
                                        </td>
                                        <td style={{ padding: '0.4rem 0.6rem' }}>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => void handleStop(s.cp_id, s.connector_id)}
                                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                            >
                                                <Square size={12} /> stop
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
