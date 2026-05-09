import React, { useState } from 'react';
import { fleetApi, CPType, FleetGroup, PhaseMode } from './fleet-api';
import { DialogShell, Field, DialogActions, inputStyle } from './NewGroupDialog';

interface NewCpDialogProps {
    groups: FleetGroup[];
    onClose: () => void;
    onCreated: () => void;
    onAction: (msg: string) => void;
}

export const NewCpDialog: React.FC<NewCpDialogProps> = ({ groups, onClose, onCreated, onAction }) => {
    const [type, setType] = useState<CPType>('AC');
    const [displayName, setDisplayName] = useState('');
    const [groupId, setGroupId] = useState<number | null>(null);
    const [phaseMode, setPhaseMode] = useState<PhaseMode>('balanced');
    const [busy, setBusy] = useState(false);

    // Filter group dropdown by matching type — the API rejects mismatches.
    const eligibleGroups = groups.filter((g) => g.type === type);

    const submit = async (): Promise<void> => {
        setBusy(true);
        try {
            const cp = await fleetApi.createCP({
                type,
                display_name: displayName.trim() || undefined,
                group_id: groupId ?? null,
                phase_mode: type === 'AC' ? phaseMode : undefined,
            });
            onAction(`CP ${cp.cp_id} (${cp.display_name}) created`);
            onCreated();
            onClose();
        } catch (err: any) {
            onAction(`create CP failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <DialogShell title="New CP" onClose={onClose}>
            <Field label="Type">
                <select
                    value={type}
                    onChange={(e) => {
                        const t = e.target.value as CPType;
                        setType(t);
                        // Reset group if it became incompatible.
                        if (groupId !== null && !groups.find((g) => g.id === groupId && g.type === t)) {
                            setGroupId(null);
                        }
                    }}
                    style={inputStyle}
                >
                    <option value="AC">AC (Type 2, 1 connector)</option>
                    <option value="DC">DC (CCS, 2 connectors)</option>
                </select>
            </Field>
            <Field label="Display name (optional — defaults to cp_id)">
                <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Lab CP #1"
                    style={inputStyle}
                />
            </Field>
            <Field label="Group">
                <select
                    value={groupId === null ? '' : String(groupId)}
                    onChange={(e) => setGroupId(e.target.value === '' ? null : Number(e.target.value))}
                    style={inputStyle}
                >
                    <option value="">— standalone (no group) —</option>
                    {eligibleGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
            </Field>
            {type === 'AC' && (
                <Field label="Phase mode">
                    <select value={phaseMode} onChange={(e) => setPhaseMode(e.target.value as PhaseMode)} style={inputStyle}>
                        <option value="balanced">balanced</option>
                        <option value="imbalanced">imbalanced (15% skew)</option>
                        <option value="single-phase">single-phase</option>
                    </select>
                </Field>
            )}
            <DialogActions>
                <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={submit} disabled={busy}>Create</button>
            </DialogActions>
        </DialogShell>
    );
};
