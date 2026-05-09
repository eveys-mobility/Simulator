import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { ChargingControls } from './components/ChargingControls';
import { LogsViewer } from './components/LogsViewer';
import { TraceViewer, TraceEntry } from './components/TraceViewer';
import { ScenarioPanel } from './components/ScenarioPanel';
import ConfigurationPanel from './components/ConfigurationPanel';
import { ManualConsumption } from './components/ManualConsumption';
import { ConnectorEditor } from './components/ConnectorEditor';
import { FleetPage } from './pages/Fleet/FleetPage';
import { api, ChargingSession, ConnectorState, PhaseMode } from './services/api';
import { Wifi, WifiOff, Settings, Server } from 'lucide-react';
import './index.css';

interface LogEntry {
    timestamp: Date;
    direction: 'incoming' | 'outgoing';
    data: any;
}

// Cheap, dependency-free routing: read `window.location.pathname`
// once and decide which top-level page to render. The single-CP UI
// already exists at `/`; the fleet admin page is under `/fleet`.
// Anything else falls through to the single-CP UI (so 404-ish paths
// stay friendly during dev).
function isFleetRoute(): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.startsWith('/fleet');
}

// Spec resolved-question #2: deep-link from /fleet → single-CP via
// `?cp=<cp_id>`. The full reuse-existing-UI-against-fleet-pubsub
// change is out of MR-G scope; here we read the param so we can
// surface a banner explaining what the viewer is connected to.
function deepLinkedCpId(): string | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('cp');
}

function App() {
    const [connected, setConnected] = useState(false);
    const [sessions, setSessions] = useState<ChargingSession[]>([]);
    const [connectors, setConnectors] = useState<ConnectorState[]>([]);
    const [statusLoaded, setStatusLoaded] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [traces, setTraces] = useState<TraceEntry[]>([]);
    const [notification, setNotification] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [activeTab, setActiveTab] = useState<'simulator' | 'configuration'>('simulator');
    const [fleetRoute] = useState<boolean>(isFleetRoute);
    const [deepLinkedCp] = useState<string | null>(deepLinkedCpId);

    const sessionFor = (connectorId: number): ChargingSession | null =>
        sessions.find(s => s.connectorId === connectorId) ?? null;

    useEffect(() => {
        // Skip the single-CP backend chatter when we're rendering the
        // fleet page. Saves a 5 s timer + a WS that 404s when the
        // single-CP backend on :3001 isn't running (common in fleet-
        // only sessions).
        if (fleetRoute) return;

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
            setSessions(status.sessions || []);
            // Only overwrite the connector list when the payload really
            // includes it — a partial payload (older code path, an empty
            // periodic push) must never wipe known state, which used to
            // make the UI flicker between "2 connectors" and "no
            // connectors reported" every 2 seconds.
            if (Array.isArray(status.connectors)) {
                setConnectors(status.connectors);
            }
            setStatusLoaded(true);
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
            case 'trace':
                // Cap at 2000 to keep the React list bounded — backend
                // already trims its own buffer to the same size.
                setTraces(prev => {
                    const next = [...prev, message.data as TraceEntry];
                    return next.length > 2000 ? next.slice(-2000) : next;
                });
                break;
            case 'traces':
                setTraces(message.data || []);
                break;
            case 'session':
                // Backend pushes a single session — splice it into the
                // sessions list, replacing any prior entry on the same
                // connector. Empty/null payload removes the matching one.
                setSessions(prev => {
                    if (!message.data) return prev;
                    const others = prev.filter(s => s.connectorId !== message.data.connectorId);
                    return [...others, message.data];
                });
                break;
            case 'status':
                setConnected(message.data.connected);
                if (Array.isArray(message.data.sessions)) {
                    setSessions(message.data.sessions);
                }
                if (Array.isArray(message.data.connectors)) {
                    setConnectors(message.data.connectors);
                }
                setStatusLoaded(true);
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
                        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>
                            {fleetRoute ? 'Fleet Admin' : 'Charge Point Simulator'}
                        </h1>
                        <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.9 }}>
                            {fleetRoute
                                ? 'Multi-CP fleet runtime — groups, load balancing, sessions'
                                : '22kW AC Charging Station - OCPP 1.6J Protocol'}
                        </p>
                    </div>
                    <a
                        href={fleetRoute ? '/' : '/fleet'}
                        style={{
                            marginLeft: '1rem',
                            color: 'white',
                            textDecoration: 'none',
                            padding: '0.4rem 0.75rem',
                            borderRadius: '4px',
                            background: 'rgba(255,255,255,0.15)',
                            fontSize: '0.85rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                        }}
                    >
                        <Server size={16} />
                        {fleetRoute ? 'Single CP' : 'Fleet'}
                    </a>
                </div>
            </div>

            <div className="container">
                {notification && (
                    <div className="alert alert-info">
                        <Settings size={20} />
                        {notification}
                    </div>
                )}

                {fleetRoute ? (
                    <FleetPage onNotify={showNotification} />
                ) : (
                <>
                {deepLinkedCp && (
                    <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
                        <strong>Deep-linked from fleet:</strong> <code>{deepLinkedCp}</code>.
                        This view shows the local single-CP backend on :3001 (whatever cp_id it was booted with).
                        Fleet-wide per-CP detail is a follow-up — for now, use the fleet page for cross-CP visibility.
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
                        <div className="card" style={{ marginBottom: '1.5rem' }}>
                            <div className="card-header">
                                <h2 className="card-title">Charge Point</h2>
                                <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
                                    <span className="status-dot" />
                                    {connected ? 'Connected' : 'Disconnected'}
                                </span>
                            </div>
                            <div className="card-body">
                                <span style={{ color: 'var(--text-muted)' }}>Connectors:</span>{' '}
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{connectors.length || 0}</span>
                            </div>
                        </div>

                        {connectors.length === 0 ? (
                            statusLoaded ? (
                                <div className="alert alert-info">No connectors configured.</div>
                            ) : null
                        ) : connectors.map((connector) => {
                            const sess = sessionFor(connector.id);
                            return (
                                <div key={connector.id} style={{ marginBottom: '1.5rem' }}>
                                    <div className="grid">
                                        <Dashboard connector={connector} session={sess} />
                                        <ChargingControls
                                            connectorId={connector.id}
                                            hasActiveSession={!!sess}
                                            sessionStatus={sess?.status ?? null}
                                            connectorType={connector.connectorType}
                                            phaseMode={connector.phaseMode}
                                            onAction={showNotification}
                                        />
                                        <ManualConsumption
                                            connectorId={connector.id}
                                            hasActiveSession={!!sess && sess.status === 'Charging'}
                                            onAction={showNotification}
                                        />
                                    </div>
                                    <ConnectorEditor
                                        connector={connector}
                                        onChange={fetchStatus}
                                        onAction={showNotification}
                                    />
                                </div>
                            );
                        })}

                        <div style={{ marginTop: '1.5rem' }}>
                            <ScenarioPanel onAction={showNotification} />
                        </div>

                        <div style={{ marginTop: '1.5rem' }}>
                            <TraceViewer traces={traces} />
                        </div>

                        <div style={{ marginTop: '1.5rem' }}>
                            <LogsViewer logs={logs} />
                        </div>
                    </>
                ) : (
                    <ConfigurationPanel />
                )}
                </>
                )}
            </div>
        </div>
    );
}

export default App;
