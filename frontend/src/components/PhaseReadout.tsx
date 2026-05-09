import React from 'react';
import { PhaseFrame } from '../services/api';

interface PhaseReadoutProps {
    frame: PhaseFrame | null | undefined;
}

const NUMBER_FMT = (n: number, digits: number): string => {
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(digits);
};

/**
 * Three-column readout of L1/L2/L3 voltage, current, and active
 * power. Renders a placeholder when no frame is available (idle
 * connector or first tick before the simulation loop has run).
 */
export const PhaseReadout: React.FC<PhaseReadoutProps> = ({ frame }) => {
    const phases: Array<{ label: string; reading: PhaseFrame['l1'] | null }> = [
        { label: 'L1', reading: frame?.l1 ?? null },
        { label: 'L2', reading: frame?.l2 ?? null },
        { label: 'L3', reading: frame?.l3 ?? null },
    ];

    return (
        <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Per-phase readout
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                {phases.map(({ label, reading }) => (
                    <div
                        key={label}
                        style={{
                            padding: '0.75rem',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            textAlign: 'center',
                        }}
                    >
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                            {label}
                        </div>
                        <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: '0.25rem' }}>
                            {reading ? NUMBER_FMT(reading.power_w / 1000, 2) : '—'}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>kW</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            {reading ? `${NUMBER_FMT(reading.current_a, 1)} A` : '—'}
                            {' · '}
                            {reading ? `${NUMBER_FMT(reading.voltage_v, 0)} V` : '—'}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
