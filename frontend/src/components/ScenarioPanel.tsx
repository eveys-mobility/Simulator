import React, { useState, useEffect } from 'react';
import { Zap, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

interface ScenarioPanelProps {
    onAction: (action: string) => void;
}

const scenarios = [
    {
        id: 'emergency_stop',
        title: 'Emergency Stop',
        description: 'Simulate emergency button press',
        icon: '🚨'
    },
    {
        id: 'network_offline',
        title: 'Network Offline',
        description: 'Disconnect from OCPP server',
        icon: '📡'
    },
    {
        id: 'network_online',
        title: 'Network Online',
        description: 'Reconnect to OCPP server',
        icon: '✅'
    },
    {
        id: 'user_pause_from_car',
        title: 'User Pause (EV)',
        description: 'User pauses from car',
        icon: '⏸️'
    },
    {
        id: 'user_resume_from_car',
        title: 'User Resume (EV)',
        description: 'User resumes from car',
        icon: '▶️'
    },
    {
        id: 'connector_unlock',
        title: 'Connector Unlock',
        description: 'Unlock during charging',
        icon: '🔓'
    },
    {
        id: 'over_temperature',
        title: 'Over Temperature',
        description: 'Temperature fault',
        icon: '🌡️'
    },
    {
        id: 'ground_fault',
        title: 'Ground Fault',
        description: 'Ground failure detected',
        icon: '⚡'
    },
    {
        id: 'power_outage',
        title: 'Power Outage',
        description: 'Simulate power loss',
        icon: '🔌'
    },
    {
        id: 'power_restored',
        title: 'Power Restored',
        description: 'Power comes back',
        icon: '💡'
    }
];

export const ScenarioPanel: React.FC<ScenarioPanelProps> = ({ onAction }) => {
    const [loading, setLoading] = useState<string | null>(null);

    const handleScenario = async (scenarioId: string) => {
        setLoading(scenarioId);
        try {
            const result = await api.simulateScenario(scenarioId, 1);
            if (result.success) {
                onAction(`✓ ${result.message}`);
            } else {
                onAction(`✗ ${result.message}`);
            }
        } catch (error: any) {
            onAction(`✗ Error: ${error.message}`);
        } finally {
            setLoading(null);
        }
    };

    return (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
                <h2 className="card-title">
                    <AlertTriangle size={24} />
                    Scenario Simulation
                </h2>
            </div>
            <div className="card-body">
                <div className="scenario-grid">
                    {scenarios.map((scenario) => (
                        <button
                            key={scenario.id}
                            className="scenario-btn"
                            onClick={() => handleScenario(scenario.id)}
                            disabled={loading === scenario.id}
                        >
                            <div style={{ fontSize: '1.5rem' }}>{scenario.icon}</div>
                            <div className="scenario-btn-title">{scenario.title}</div>
                            <div className="scenario-btn-desc">{scenario.description}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
