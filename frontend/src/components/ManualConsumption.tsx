import React, { useState } from 'react';
import { Zap, Send } from 'lucide-react';
import { api } from '../services/api';

interface ManualConsumptionProps {
    connectorId: number;
    hasActiveSession: boolean;
    onAction: (message: string) => void;
}

export function ManualConsumption({ connectorId, hasActiveSession, onAction }: ManualConsumptionProps) {
    const [energy, setEnergy] = useState('1000');
    const [sendMode, setSendMode] = useState<'single' | 'split'>('single');
    const [splitCount, setSplitCount] = useState('5');
    const [loading, setLoading] = useState(false);

    const handleSend = async () => {
        if (!hasActiveSession) {
            onAction(`Connector ${connectorId}: no active session`);
            return;
        }

        const energyWh = parseInt(energy);
        if (isNaN(energyWh) || energyWh <= 0) {
            onAction('Invalid energy value');
            return;
        }

        setLoading(true);
        try {
            const result = await api.manualConsumption({
                connectorId,
                energyWh,
                mode: sendMode,
                splitCount: sendMode === 'split' ? parseInt(splitCount) : 1,
            });
            if (result.success) {
                onAction(`Connector ${connectorId}: sent ${energyWh} Wh (${sendMode})`);
            } else {
                onAction(`Connector ${connectorId} error: ${result.message ?? 'unknown'}`);
            }
        } catch (error: any) {
            onAction(`Connector ${connectorId} error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="card-title">
                    <Zap size={20} />
                    Connector {connectorId} — Manual Consumption
                </h3>
            </div>
            <div className="card-body">
                <div className="input-group">
                    <label>Energy (Wh)</label>
                    <input
                        type="number"
                        value={energy}
                        onChange={(e) => setEnergy(e.target.value)}
                        placeholder="Enter energy in Wh"
                        min="1"
                        step="100"
                    />
                </div>

                <div className="input-group">
                    <label>Send Mode</label>
                    <select value={sendMode} onChange={(e) => setSendMode(e.target.value as 'single' | 'split')}>
                        <option value="single">Single Message</option>
                        <option value="split">Split into Multiple</option>
                    </select>
                </div>

                {sendMode === 'split' && (
                    <div className="input-group">
                        <label>Number of Parts</label>
                        <input
                            type="number"
                            value={splitCount}
                            onChange={(e) => setSplitCount(e.target.value)}
                            placeholder="Number of meter value messages"
                            min="2"
                            max="20"
                        />
                    </div>
                )}

                <button
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={!hasActiveSession || loading}
                    style={{ width: '100%', marginTop: '1rem' }}
                >
                    <Send size={20} />
                    {loading ? 'Sending...' : 'Send Manual Consumption'}
                </button>

                {!hasActiveSession && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem', textAlign: 'center' }}>
                        Start a charging session first
                    </p>
                )}
            </div>
        </div>
    );
}
