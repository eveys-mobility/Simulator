import React from 'react';
import { DCFrame, DCBatteryProfile } from '../services/api';

interface DCReadoutProps {
    frame: DCFrame | null | undefined;
    profile?: DCBatteryProfile;
}

const fmt = (n: number | undefined, digits: number, fallback = '—'): string =>
    typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : fallback;

/**
 * DC charge readout: SoC bar + a 3-cell strip with bus voltage,
 * DC current, and active power. Mirrors the PhaseReadout component
 * for AC, but no phase tags — DC is single-conductor.
 */
export const DCReadout: React.FC<DCReadoutProps> = ({ frame, profile }) => {
    const targetSoc = profile?.target_soc_pct ?? 80;
    const socPct = frame?.soc_pct;
    const socWidth = typeof socPct === 'number' ? Math.min(100, Math.max(0, socPct)) : 0;

    return (
        <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                DC battery state
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.875rem',
                    marginBottom: '0.25rem',
                }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                        SoC: {fmt(socPct, 0)}%
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        target {targetSoc}%
                    </span>
                </div>
                <div className="progress-bar" style={{ position: 'relative' }}>
                    <div
                        className="progress-fill"
                        style={{
                            width: `${socWidth}%`,
                            background: frame?.completed ? 'var(--accent-success)' : undefined,
                        }}
                    />
                    <div
                        style={{
                            position: 'absolute',
                            left: `${targetSoc}%`,
                            top: 0,
                            bottom: 0,
                            borderLeft: '2px dashed var(--text-muted)',
                            opacity: 0.5,
                        }}
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <div style={{ padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>BUS</div>
                    <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: '0.25rem' }}>
                        {fmt(frame?.voltage_v, 0)}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>V</span>
                    </div>
                </div>
                <div style={{ padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CURRENT</div>
                    <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: '0.25rem' }}>
                        {fmt(frame?.current_a, 1)}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>A</span>
                    </div>
                </div>
                <div style={{ padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>POWER</div>
                    <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: '0.25rem' }}>
                        {fmt((frame?.power_w ?? 0) / 1000, 1)}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>kW</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
