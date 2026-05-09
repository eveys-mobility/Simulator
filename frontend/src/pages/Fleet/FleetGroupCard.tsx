import React from 'react';
import { Trash2 } from 'lucide-react';
import { fleetApi, FleetCP, FleetGroup } from './fleet-api';
import { CpTile } from './CpTile';

interface FleetGroupCardProps {
    group: FleetGroup;
    cps: FleetCP[];
    /** Server-broadcast rollup: { total_kw, active_sessions }. */
    summary?: { total_kw: number; active_sessions: number };
    onCpClick: (cp_id: string) => void;
    onMutate: () => void;
    onAction: (msg: string) => void;
}

export const FleetGroupCard: React.FC<FleetGroupCardProps> = ({ group, cps, summary, onCpClick, onMutate, onAction }) => {
    const handleDelete = async (): Promise<void> => {
        if (!confirm(`Delete group "${group.name}"? CPs in it will become standalone.`)) return;
        try {
            await fleetApi.deleteGroup(group.id);
            onAction(`group ${group.name} deleted`);
            onMutate();
        } catch (err: any) {
            onAction(`delete failed: ${err.message}`);
        }
    };

    const totalKw = summary?.total_kw ?? 0;
    const activeSessions = summary?.active_sessions ?? 0;

    return (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 className="card-title" style={{ margin: 0 }}>
                    <span style={{
                        marginRight: '0.5rem',
                        fontSize: '0.65rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: group.type === 'DC' ? '#f59e0b' : '#3b82f6',
                        color: 'white',
                        verticalAlign: 'middle',
                    }}>
                        {group.type}
                    </span>
                    {group.name}
                </h2>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    {cps.length} CPs · {activeSessions} active · {totalKw.toFixed(1)} kW
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        className="btn btn-secondary"
                        onClick={handleDelete}
                        title="Delete group"
                        style={{ padding: '0.4rem 0.6rem' }}
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
            <div className="card-body">
                {cps.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                        No CPs assigned to this group yet.
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: '0.5rem',
                    }}>
                        {cps.map((cp) => {
                            const tickPower = Object.values(cp.last_tick).reduce((s, t) => s + (t.power_kw > 0 ? t.power_kw : 0), 0);
                            const charging = Object.values(cp.connector_status).some((s) => s === 'Charging');
                            return (
                                <CpTile
                                    key={cp.cp_id}
                                    cp={cp}
                                    powerKw={tickPower}
                                    isCharging={charging}
                                    onClick={() => onCpClick(cp.cp_id)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
