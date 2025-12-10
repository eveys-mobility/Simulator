import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { ChargingControls } from './components/ChargingControls';
import { LogsViewer } from './components/LogsViewer';
import { ScenarioPanel } from './components/ScenarioPanel';
import ConfigurationPanel from './components/ConfigurationPanel';
import { ManualConsumption } from './components/ManualConsumption';
import { api, ChargingSession } from './services/api';
import { Wifi, WifiOff, Settings } from 'lucide-react';
import './index.css';

interface LogEntry {
    timestamp: Date;
    direction: 'incoming' | 'outgoing';
    data: any;
}

function App() {
    const [connected, setConnected] = useState(false);
    const [session, setSession] = useState<ChargingSession | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [notification, setNotification] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [activeTab, setActiveTab] = useState<'simulator' | 'configuration'>('simulator');

    useEffect(() => {
        // Initial status fetch
        fetchStatus();

        // Connect WebSocket
        api.connectWebSocket((message) => {
            handleWebSocketMessage(message);
        });

        // Periodic status updates
        const interval = setInterval(fetchStatus, 5000);

        return () => {
            clearInterval(interval);
            api.disconnectWebSocket();
        };
    }, []);

    const fetchStatus = async () => {
        try {
            const status = await api.getStatus();
            setConnected(status.connected);
            if (status.sessions.length > 0) {
                setSession(status.sessions[0]);
            } else {
                setSession(null);
            }
        } catch (error) {
            console.error('Error fetching status:', error);
        }
    };

    const handleWebSocketMessage = (message: any) => {
        switch (message.type) {
            case 'log':
                setLogs(prev => [...prev, message.data]);
                break;
            case 'logs':
                setLogs(message.data);
                break;
            case 'session':
                setSession(message.data);
                break;
            case 'status':
                setConnected(message.data.connected);
                if (message.data.sessions.length > 0) {
                    setSession(message.data.sessions[0]);
                } else {
                    setSession(null);
                }
                break;
            case 'event':
                handleEvent(message.event, message.data);
                break;
        }
    };

    const handleEvent = (event: string, data: any) => {
        switch (event) {
            case 'connected':
                setConnected(true);
                showNotification('Connected to OCPP server');
                break;
            case 'disconnected':
                setConnected(false);
                showNotification('Disconnected from OCPP server');
                break;
            case 'transactionStarted':
                showNotification('Charging session started');
                break;
            case 'transactionStopped':
                showNotification('Charging session stopped');
                break;
            case 'transactionPaused':
                showNotification('Charging paused');
                break;
            case 'transactionResumed':
                showNotification('Charging resumed');
                break;
            case 'scenarioExecuted':
                showNotification(`Scenario executed: ${data.type}`);
                break;
        }
    };

    const showNotification = (message: string) => {
        setNotification(message);
        setTimeout(() => setNotification(null), 5000);
    };

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const result = await api.connect();
            if (result.success) {
                showNotification('Connected successfully');
            } else {
                showNotification(`Connection failed: ${result.message}`);
            }
        } catch (error: any) {
            showNotification(`Error: ${error.message}`);
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        setConnecting(true);
        try {
            const result = await api.disconnect();
            if (result.success) {
                showNotification('Disconnected successfully');
            } else {
                showNotification(`Disconnect failed: ${result.message}`);
            }
        } catch (error: any) {
            showNotification(`Error: ${error.message}`);
        } finally {
            setConnecting(false);
        }
    };

    return (
        <div className="app">
            <div className="header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'center' }}>
                    <img
                        src="/src/assets/eveys-white.svg"
                        alt="Eveys"
                        style={{ height: '48px', width: 'auto' }}
                    />
                    <div style={{ borderLeft: '2px solid rgba(255,255,255,0.3)', height: '48px' }}></div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>Charge Point Simulator</h1>
                        <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.9 }}>22kW AC Charging Station - OCPP 1.6J Protocol</p>
                    </div>
                </div>
            </div>

            <div className="container">
                {notification && (
                    <div className="alert alert-info">
                        <Settings size={20} />
                        {notification}
                    </div>
                )}

                <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            className={`btn ${activeTab === 'simulator' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setActiveTab('simulator')}
                        >
                            Simulator
                        </button>
                        <button
                            className={`btn ${activeTab === 'configuration' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setActiveTab('configuration')}
                        >
                            <Settings size={20} />
                            Configuration
                        </button>
                    </div>

                    {activeTab === 'simulator' && (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            {!connected ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleConnect}
                                    disabled={connecting}
                                >
                                    <Wifi size={20} />
                                    Connect to OCPP Server
                                </button>
                            ) : (
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleDisconnect}
                                    disabled={connecting}
                                >
                                    <WifiOff size={20} />
                                    Disconnect
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {activeTab === 'simulator' ? (
                    <>
                        <div className="grid">
                            <Dashboard connected={connected} session={session} />
                            <ChargingControls
                                hasActiveSession={!!session}
                                sessionStatus={session?.status || null}
                                onAction={showNotification}
                            />
                            <ManualConsumption
                                hasActiveSession={!!session}
                                onAction={showNotification}
                            />
                        </div>

                        <div style={{ marginTop: '1.5rem' }}>
                            <ScenarioPanel onAction={showNotification} />
                        </div>

                        <div style={{ marginTop: '1.5rem' }}>
                            <LogsViewer logs={logs} />
                        </div>
                    </>
                ) : (
                    <ConfigurationPanel />
                )}
            </div>
        </div>
    );
}

export default App;
