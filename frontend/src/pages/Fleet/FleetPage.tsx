import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
    fleetApi,
    connectFleetWS,
    FleetCP,
    FleetGroup,
    FleetSession,
    FleetWSMessage,
} from './fleet-api';
import { FleetGroupCard } from './FleetGroupCard';
import { ActiveSessionsTable } from './ActiveSessionsTable';
import { NewGroupDialog } from './NewGroupDialog';
import { NewCpDialog } from './NewCpDialog';

interface FleetPageProps {
    onNotify: (msg: string) => void;
}

interface GroupSummary {
    total_kw: number;
    active_sessions: number;
}

export const FleetPage: React.FC<FleetPageProps> = ({ onNotify }) => {
    const [groups, setGroups] = useState<FleetGroup[]>([]);
    const [cps, setCps] = useState<FleetCP[]>([]);
    const [sessions, setSessions] = useState<FleetSession[]>([]);
    const [summaries, setSummaries] = useState<Map<number, GroupSummary>>(new Map());
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [showNewCp, setShowNewCp] = useState(false);

    const refresh = async (): Promise<void> => {
        try {
            const [g, c, s] = await Promise.all([
                fleetApi.listGroups(),
                fleetApi.listCPs(),
                fleetApi.listSessions({ status: 'active', limit: 200 }),
            ]);
            setGroups(g);
            setCps(c);
            setSessions(s);
        } catch (err: any) {
            onNotify(`refresh failed: ${err.message}`);
        }
    };

    useEffect(() => {
        void refresh();
        const interval = window.setInterval(refresh, 5000); // safety net for missed WS events

        const stop = connectFleetWS((msg: FleetWSMessage) => {
            switch (msg.type) {
                case 'hello':
                    if (Array.isArray(msg.cps)) setCps(msg.cps);
                    if (Array.isArray(msg.groups)) setGroups(msg.groups);
                    break;
                case 'cp_state':
                    // Apply patch to the matching CP without a full
                    // refetch — keep the UI snappy when 100 CPs flip
                    // status simultaneously on a fleet-wide event.
                    setCps((prev) => prev.map((cp) => {
                        if (cp.cp_id !== msg.cp_id) return cp;
                        if (msg.event === 'connected') return { ...cp, online: true };
                        if (msg.event === 'disconnected') return { ...cp, online: false };
                        if (msg.event === 'connector_status' && typeof msg.connector_id === 'number' && typeof msg.status === 'string') {
                            return { ...cp, connector_status: { ...cp.connector_status, [msg.connector_id]: msg.status } };
                        }
                        return cp;
                    }));
                    break;
                case 'session_started':
                case 'session_ended':
                    // Sessions table comes from the REST endpoint —
                    // re-fetch on either edge so the row appears /
                    // disappears with the right energy_wh from SQLite.
                    void refresh();
                    break;
                case 'meter_summary':
                    setSummaries((prev) => {
                        const next = new Map(prev);
                        next.set(msg.group_id, { total_kw: msg.total_kw, active_sessions: msg.active_sessions });
                        return next;
                    });
                    break;
            }
        });

        return () => {
            window.clearInterval(interval);
            stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Bucket CPs by group_id so each FleetGroupCard renders its slice
    // without the parent recomputing across renders.
    const cpsByGroup = useMemo(() => {
        const m = new Map<number | 'standalone', FleetCP[]>();
        for (const cp of cps) {
            const k = cp.group_id ?? 'standalone';
            const arr = m.get(k) ?? [];
            arr.push(cp);
            m.set(k, arr);
        }
        return m;
    }, [cps]);

    const standaloneCps = cpsByGroup.get('standalone') ?? [];

    const handleCpClick = (cp_id: string): void => {
        // Per the spec's resolved Q2: deep-link into the single-CP UI
        // by adding ?cp=<cp_id>. App.tsx's switch picks it up.
        window.location.search = `?cp=${encodeURIComponent(cp_id)}`;
    };

    return (
        <div>
            <div style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end',
                marginBottom: '1rem',
                flexWrap: 'wrap',
            }}>
                <button className="btn btn-primary" onClick={() => setShowNewGroup(true)}>
                    <Plus size={18} /> New group
                </button>
                <button className="btn btn-primary" onClick={() => setShowNewCp(true)}>
                    <Plus size={18} /> New CP
                </button>
            </div>

            {groups.length === 0 && standaloneCps.length === 0 && (
                <div className="alert alert-info">
                    No groups or CPs yet — click "New group" then "New CP" to get started.
                </div>
            )}

            {groups.map((g) => (
                <FleetGroupCard
                    key={g.id}
                    group={g}
                    cps={(cpsByGroup.get(g.id) ?? []).sort((a, b) => a.cp_id.localeCompare(b.cp_id))}
                    summary={summaries.get(g.id)}
                    onCpClick={handleCpClick}
                    onMutate={() => void refresh()}
                    onAction={onNotify}
                />
            ))}

            {standaloneCps.length > 0 && (
                <div className="card" style={{ marginBottom: '1.5rem' }}>
                    <div className="card-header">
                        <h2 className="card-title">Standalone CPs ({standaloneCps.length})</h2>
                    </div>
                    <div className="card-body">
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                            gap: '0.5rem',
                        }}>
                            {standaloneCps
                                .sort((a, b) => a.cp_id.localeCompare(b.cp_id))
                                .map((cp) => {
                                    const tickPower = Object.values(cp.last_tick).reduce((s, t) => s + (t.power_kw > 0 ? t.power_kw : 0), 0);
                                    const charging = Object.values(cp.connector_status).some((s) => s === 'Charging');
                                    return (
                                        <CpTileLink
                                            key={cp.cp_id}
                                            cp={cp}
                                            powerKw={tickPower}
                                            isCharging={charging}
                                            onClick={() => handleCpClick(cp.cp_id)}
                                        />
                                    );
                                })}
                        </div>
                    </div>
                </div>
            )}

            <ActiveSessionsTable
                sessions={sessions}
                onAction={onNotify}
                onMutate={() => void refresh()}
            />

            {showNewGroup && (
                <NewGroupDialog
                    onClose={() => setShowNewGroup(false)}
                    onCreated={() => void refresh()}
                    onAction={onNotify}
                />
            )}
            {showNewCp && (
                <NewCpDialog
                    groups={groups}
                    onClose={() => setShowNewCp(false)}
                    onCreated={() => void refresh()}
                    onAction={onNotify}
                />
            )}
        </div>
    );
};

// Tiny re-export to keep CpTile's import stable for FleetGroupCard;
// the standalone section reuses the same component.
import { CpTile } from './CpTile';
const CpTileLink = CpTile;
