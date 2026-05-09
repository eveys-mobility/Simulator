import React from 'react';
import { FleetCP } from './fleet-api';

interface CpTileProps {
    cp: FleetCP;
    /** Live total power in kW (sum of last_tick.power_kw across connectors). */
    powerKw: number;
    /** True when at least one connector is currently Charging. */
    isCharging: boolean;
    onClick?: () => void;
}

const tileBackground = (cp: FleetCP, isCharging: boolean): string => {
    if (!cp.online) return '#374151';                 // grey: worker alive but no WS
    if (cp.connector_status['1'] === 'Faulted') return '#dc2626';  // red
    if (isCharging) return '#1e40af';                 // blue
    return '#065f46';                                 // green: idle + online
};

/**
 * Single CP cell in the fleet grid. Shows the status, the live
 * power summed across connectors, and the AC/DC pill. Clicks
 * through to the single-CP UI via `?cp=<cp_id>`.
 */
export const CpTile: React.FC<CpTileProps> = ({ cp, powerKw, isCharging, onClick }) => {
    const status = cp.connector_status['1'] ?? 'Unknown';
    return (
        <button
            onClick={onClick}
            title={`${cp.cp_id}\n${cp.display_name}\nstatus: ${status}\nonline: ${cp.online}`}
            style={{
                position: 'relative',
                padding: '0.75rem 0.5rem',
                background: tileBackground(cp, isCharging),
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: '0.8rem',
                minHeight: '70px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: cp.online ? 1 : 0.55,
                transition: 'transform 80ms ease',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span
                    style={{
                        fontSize: '0.6rem',
                        padding: '0.05rem 0.3rem',
                        borderRadius: '3px',
                        background: cp.type === 'DC' ? '#f59e0b' : 'rgba(255,255,255,0.2)',
                        fontWeight: 700,
                    }}
                >
                    {cp.type}
                </span>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cp.display_name}
                </span>
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                {isCharging ? `${powerKw.toFixed(1)} kW` : status === 'Faulted' ? '⚠ fault' : 'idle'}
            </div>
            <div style={{ fontSize: '0.65rem', opacity: 0.7, fontFamily: 'monospace' }}>
                {cp.cp_id}
            </div>
        </button>
    );
};
