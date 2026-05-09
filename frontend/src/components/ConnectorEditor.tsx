import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { api, ConnectorState, ConnectorType, DCBatteryProfile } from '../services/api';

interface ConnectorEditorProps {
    connector: ConnectorState;
    onChange?: () => void;
    onAction: (msg: string) => void;
}

/**
 * Per-connector configuration panel: AC/DC toggle, and (when DC)
 * the battery / charger profile fields. Renders as a collapsible
 * `<details>` so it stays out of the way until needed. Disabled
 * while `hasActiveSession` is true — flipping connector type or
 * battery capacity mid-session would corrupt the running simulation.
 */
export const ConnectorEditor: React.FC<ConnectorEditorProps> = ({ connector, onChange, onAction }) => {
    const [busy, setBusy] = useState(false);
    const isDC = connector.connectorType === 'DC';
    const profile = connector.dcProfile;

    // Local-edit state; submitted as a single PATCH on Save.
    const [draft, setDraft] = useState<Partial<DCBatteryProfile>>({});
    const merged: DCBatteryProfile = {
        capacity_kwh: 60,
        charger_max_kw: 100,
        nominal_voltage_v: 400,
        initial_soc_pct: 20,
        target_soc_pct: 80,
        ramp_up_seconds: 25,
        ...profile,
        ...draft,
    };

    const setNum = (key: keyof DCBatteryProfile) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const n = Number(e.target.value);
        setDraft((d) => ({ ...d, [key]: Number.isFinite(n) ? n : undefined }));
    };

    const handleTypeChange = async (type: ConnectorType) => {
        if (busy || type === connector.connectorType) return;
        if (connector.hasActiveSession) {
            onAction(`Connector ${connector.id}: stop the session before switching type`);
            return;
        }
        setBusy(true);
        try {
            const r = await api.setConnectorType(connector.id, type);
            if (r?.success) {
                onAction(`Connector ${connector.id}: type → ${type}`);
                onChange?.();
            } else {
                onAction(`Connector ${connector.id} error: ${r?.message ?? 'unknown'}`);
            }
        } catch (e: any) {
            onAction(`Connector ${connector.id} error: ${e.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleSaveProfile = async () => {
        if (busy) return;
        if (Object.keys(draft).length === 0) {
            onAction(`Connector ${connector.id}: nothing to save`);
            return;
        }
        setBusy(true);
        try {
            const r = await api.setDCProfile(connector.id, draft);
            if (r?.success) {
                onAction(`Connector ${connector.id}: DC profile saved`);
                setDraft({});
                onChange?.();
            } else {
                onAction(`Connector ${connector.id} error: ${r?.message ?? 'unknown'}`);
            }
        } catch (e: any) {
            onAction(`Connector ${connector.id} error: ${e.message}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <details
            className="card"
            style={{ marginTop: '1rem' }}
        >
            <summary
                style={{
                    cursor: 'pointer',
                    padding: '0.75rem 1rem',
                    listStyle: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontWeight: 600,
                }}
            >
                <Settings size={18} />
                Connector {connector.id} configuration
                <span style={{
                    marginLeft: 'auto',
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: isDC ? 'var(--accent-warning, #f59e0b)' : 'var(--accent-primary, #3b82f6)',
                    color: 'white',
                }}>
                    {isDC ? 'DC' : 'AC'}
                </span>
            </summary>

            <div className="card-body">
                <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                        Connector type
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            className={`btn ${!isDC ? 'btn-primary' : 'btn-secondary'}`}
                            disabled={busy || connector.hasActiveSession}
                            onClick={() => handleTypeChange('AC')}
                            style={{ flex: 1 }}
                        >
                            AC (Type 2)
                        </button>
                        <button
                            className={`btn ${isDC ? 'btn-primary' : 'btn-secondary'}`}
                            disabled={busy || connector.hasActiveSession}
                            onClick={() => handleTypeChange('DC')}
                            style={{ flex: 1 }}
                        >
                            DC (CCS)
                        </button>
                    </div>
                    {connector.hasActiveSession && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                            Stop the active session to change connector type.
                        </div>
                    )}
                </div>

                {isDC && (
                    <div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                            DC battery / charger profile
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                            <NumberField label="Capacity (kWh)"     value={merged.capacity_kwh}        onChange={setNum('capacity_kwh')}      step={1} />
                            <NumberField label="Charger max (kW)"   value={merged.charger_max_kw}      onChange={setNum('charger_max_kw')}    step={5} />
                            <NumberField label="Nominal voltage (V)" value={merged.nominal_voltage_v ?? 400} onChange={setNum('nominal_voltage_v')} step={10} />
                            <NumberField label="Ramp-up (s)"        value={merged.ramp_up_seconds ?? 25} onChange={setNum('ramp_up_seconds')}    step={1} />
                            <NumberField label="Initial SoC (%)"    value={merged.initial_soc_pct}     onChange={setNum('initial_soc_pct')}   step={1} min={0} max={100} />
                            <NumberField label="Target SoC (%)"     value={merged.target_soc_pct ?? 80} onChange={setNum('target_soc_pct')}    step={1} min={1} max={100} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                            <button
                                className="btn btn-success"
                                disabled={busy || Object.keys(draft).length === 0}
                                onClick={handleSaveProfile}
                                style={{ flex: 1 }}
                            >
                                Save profile
                            </button>
                            <button
                                className="btn btn-secondary"
                                disabled={busy || Object.keys(draft).length === 0}
                                onClick={() => setDraft({})}
                            >
                                Discard
                            </button>
                        </div>
                        {connector.hasActiveSession && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                Profile changes apply on the next session — not the one currently running.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </details>
    );
};

interface NumberFieldProps {
    label: string;
    value: number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    step?: number;
    min?: number;
    max?: number;
}

const NumberField: React.FC<NumberFieldProps> = ({ label, value, onChange, step, min, max }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <input
            type="number"
            value={Number.isFinite(value) ? value : ''}
            onChange={onChange}
            step={step}
            min={min}
            max={max}
            style={{
                padding: '0.5rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--bg-tertiary)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
            }}
        />
    </label>
);
