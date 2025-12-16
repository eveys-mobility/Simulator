import React, { useState } from 'react';
import { Play, Square, Pause, PlayCircle } from 'lucide-react';
import { api } from '../services/api';

interface ChargingControlsProps {
    hasActiveSession: boolean;
    sessionStatus: string | null;
    onAction: (action: string) => void;
}

export const ChargingControls: React.FC<ChargingControlsProps> = ({
    hasActiveSession,
    sessionStatus,
    onAction
}) => {
    const [idTag, setIdTag] = useState('TEST-TAG-001');
    const [loading, setLoading] = useState(false);

    const handleStartCharging = async () => {
        setLoading(true);
        try {
            const result = await api.startCharging(1, idTag);
            if (result.success) {
                onAction('Charging started successfully');
            } else {
                onAction(`Error: ${result.message}`);
            }
        } catch (error: any) {
            onAction(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleStopCharging = async () => {
        setLoading(true);
        try {
            const result = await api.stopCharging(1);
            if (result.success) {
                onAction('Charging stopped successfully');
            } else {
                onAction(`Error: ${result.message}`);
            }
        } catch (error: any) {
            onAction(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handlePauseCharging = async () => {
        setLoading(true);
        try {
            const result = await api.pauseCharging(1);
            if (result.success) {
                onAction('Charging paused');
            } else {
                onAction(`Error: ${result.message}`);
            }
        } catch (error: any) {
            onAction(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleResumeCharging = async () => {
        setLoading(true);
        try {
            const result = await api.resumeCharging(1);
            if (result.success) {
                onAction('Charging resumed');
            } else {
                onAction(`Error: ${result.message}`);
            }
        } catch (error: any) {
            onAction(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const isPaused = sessionStatus === 'Paused';
    const isCharging = sessionStatus === 'Charging';

    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">
                    <PlayCircle size={24} />
                    Charging Controls
                </h2>
            </div>
            <div className="card-body">
                {!hasActiveSession && (
                    <div className="input-group">
                        <label htmlFor="idTag">ID Tag</label>
                        <input
                            id="idTag"
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
                            onClick={handleStartCharging}
                            disabled={loading || !idTag}
                            style={{ flex: 1 }}
                        >
                            <Play size={20} />
                            Start Charging
                        </button>
                    ) : (
                        <>
                            {isPaused ? (
                                <button
                                    className="btn btn-success"
                                    onClick={handleResumeCharging}
                                    disabled={loading}
                                    style={{ flex: 1 }}
                                >
                                    <Play size={20} />
                                    Resume
                                </button>
                            ) : isCharging && (
                                <button
                                    className="btn btn-warning"
                                    onClick={handlePauseCharging}
                                    disabled={loading}
                                    style={{ flex: 1 }}
                                >
                                    <Pause size={20} />
                                    Pause
                                </button>
                            )}

                            <button
                                className="btn btn-danger"
                                onClick={handleStopCharging}
                                disabled={loading}
                                style={{ flex: 1 }}
                            >
                                <Square size={20} />
                                Stop Charging
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
