import React, { useState } from 'react';
import { api, PhaseMode } from '../services/api';

interface PhaseModeSelectorProps {
    connectorId: number;
    currentMode: PhaseMode | undefined;
    onChange?: (mode: PhaseMode) => void;
    onError?: (message: string) => void;
}

const MODES: Array<{ value: PhaseMode; label: string; hint: string }> = [
    { value: 'balanced', label: 'Balanced', hint: 'equal power on L1/L2/L3' },
    { value: 'imbalanced', label: 'Imbalanced 15%', hint: 'L1 high, L3 low' },
    { value: 'single-phase', label: 'Single-phase', hint: 'L1 only, capped ~7.4 kW' },
];

export const PhaseModeSelector: React.FC<PhaseModeSelectorProps> = ({
    connectorId,
    currentMode,
    onChange,
    onError,
}) => {
    const [busy, setBusy] = useState<PhaseMode | null>(null);

    const handleClick = async (mode: PhaseMode) => {
        if (mode === currentMode || busy) return;
        setBusy(mode);
        try {
            const result = await api.setPhaseMode(connectorId, mode);
            if (result?.success) {
                onChange?.(mode);
            } else {
                onError?.(result?.message || 'failed to set phase mode');
            }
        } catch (e: any) {
            onError?.(e?.message ?? 'network error');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Phase mode
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {MODES.map(({ value, label, hint }) => {
                    const active = value === currentMode;
                    return (
                        <button
                            key={value}
                            className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                            disabled={busy !== null}
                            onClick={() => handleClick(value)}
                            title={hint}
                            style={{ flex: '1 1 0', minWidth: '120px' }}
                        >
                            {busy === value ? '…' : label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
