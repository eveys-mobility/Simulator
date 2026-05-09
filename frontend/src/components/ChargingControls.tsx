import React, { useState } from 'react';
import { Play, Square, Pause, PlayCircle } from 'lucide-react';
import { api, PhaseMode } from '../services/api';
import { PhaseModeSelector } from './PhaseModeSelector';

interface ChargingControlsProps {
    connectorId: number;
    hasActiveSession: boolean;
    sessionStatus: string | null;
    phaseMode?: PhaseMode;
    onAction: (action: string) => void;
}

export const ChargingControls: React.FC<ChargingControlsProps> = ({
    connectorId,
    hasActiveSession,
    sessionStatus,
    phaseMode,
    onAction
}) => {
    const [idTag, setIdTag] = useState('TEST-TAG-001');
    const [loading, setLoading] = useState(false);

    const wrap = (label: string, fn: () => Promise<{ success: boolean; message?: string }>) => async () => {
        setLoading(true);
        try {
            const result = await fn();
            if (result.success) {
                onAction(`Connector ${connectorId}: ${label}`);
            } else {
                onAction(`Connector ${connectorId} error: ${result.message ?? 'unknown'}`);
            }
        } catch (error: any) {
            onAction(`Connector ${connectorId} error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleStart = wrap('charging started', () => api.startCharging(connectorId, idTag));
    const handleStop = wrap('charging stopped', () => api.stopCharging(connectorId));
    const handlePause = wrap('charging paused', () => api.pauseCharging(connectorId));
    const handleResume = wrap('charging resumed', () => api.resumeCharging(connectorId));

    const isPaused = sessionStatus === 'Paused';
    const isCharging = sessionStatus === 'Charging';

    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">
                    <PlayCircle size={20} />
                    Connector {connectorId} — Controls
                </h2>
            </div>
            <div className="card-body">
                {!hasActiveSession && (
                    <div className="input-group">
                        <label htmlFor={`idTag-${connectorId}`}>ID Tag</label>
                        <input
                            id={`idTag-${connectorId}`}
                            type="text"
                            value={idTag}
                            onChange={(e) => setIdTag(e.target.value)}
                            placeholder="Enter ID tag"
                        />
                    </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {!hasActiveSession ? (
                        <button
                            className="btn btn-success"
                            onClick={handleStart}
                            disabled={loading || !idTag}
                            style={{ flex: 1 }}
                        >
                            <Play size={20} />
                            Start
                        </button>
                    ) : (
                        <>
                            {isPaused ? (
                                <button
                                    className="btn btn-success"
                                    onClick={handleResume}
                                    disabled={loading}
                                    style={{ flex: 1 }}
                                >
                                    <Play size={20} />
                                    Resume
                                </button>
                            ) : isCharging && (
                                <button
                                    className="btn btn-warning"
                                    onClick={handlePause}
                                    disabled={loading}
                                    style={{ flex: 1 }}
                                >
                                    <Pause size={20} />
                                    Pause
                                </button>
                            )}

                            <button
                                className="btn btn-danger"
                                onClick={handleStop}
                                disabled={loading}
                                style={{ flex: 1 }}
                            >
                                <Square size={20} />
                                Stop
                            </button>
                        </>
                    )}
                </div>

                <PhaseModeSelector
                    connectorId={1}
                    currentMode={phaseMode}
                    onChange={(mode) => onAction(`Phase mode → ${mode}`)}
                    onError={(message) => onAction(`Error: ${message}`)}
                />
            </div>
        </div>
    );
};
