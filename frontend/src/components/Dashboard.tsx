import React from 'react';
import { Activity, Zap, Clock, Battery } from 'lucide-react';
import { ChargingSession } from '../services/api';

interface DashboardProps {
    connected: boolean;
    session: ChargingSession | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ connected, session }) => {
    const formatDuration = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">
                    <Activity size={24} />
                    Charge Point Status
                </h2>
                <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
                    <span className="status-dot" />
                    {connected ? 'Connected' : 'Disconnected'}
                </span>
            </div>
            <div className="card-body">
                <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <div className="metric">
                        <div className="metric-label">
                            <Zap size={16} style={{ display: 'inline', marginRight: '0.25rem' }} />
                            Power Output
                        </div>
                        <div className="metric-value">
                            {session ? session.powerKw.toFixed(2) : '0.00'}
                            <span className="metric-unit">kW</span>
                        </div>
                        {session && (
                            <div className="progress-bar">
                                <div
                                    className="progress-fill"
                                    style={{ width: `${(session.powerKw / 22) * 100}%` }}
                                />
                            </div>
                        )}
                    </div>

                    <div className="metric">
                        <div className="metric-label">
                            <Battery size={16} style={{ display: 'inline', marginRight: '0.25rem' }} />
                            Energy Delivered
                        </div>
                        <div className="metric-value">
                            {session ? session.energyKwh.toFixed(3) : '0.000'}
                            <span className="metric-unit">kWh</span>
                        </div>
                    </div>

                    <div className="metric">
                        <div className="metric-label">
                            <Clock size={16} style={{ display: 'inline', marginRight: '0.25rem' }} />
                            Session Duration
                        </div>
                        <div className="metric-value" style={{ fontSize: '1.5rem' }}>
                            {session ? formatDuration(session.duration) : '00:00:00'}
                        </div>
                    </div>

                    <div className="metric">
                        <div className="metric-label">Status</div>
                        <div className="metric-value" style={{ fontSize: '1.25rem' }}>
                            {session ? (
                                <span className={`status-badge ${session.status.toLowerCase()}`}>
                                    {session.status}
                                </span>
                            ) : (
                                <span className="status-badge">Idle</span>
                            )}
                        </div>
                    </div>
                </div>

                {session && (
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                            Transaction Details
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.875rem' }}>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>Transaction ID:</span>{' '}
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{session.transactionId || 'N/A'}</span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>Connector:</span>{' '}
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{session.connectorId}</span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>ID Tag:</span>{' '}
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{session.idTag}</span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>Start Time:</span>{' '}
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                    {new Date(session.startTime).toLocaleTimeString()}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
