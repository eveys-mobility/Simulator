import React, { useState } from 'react';
import { fleetApi, CPType, LbStrategy } from './fleet-api';

interface NewGroupDialogProps {
    onClose: () => void;
    onCreated: () => void;
    onAction: (msg: string) => void;
}

export const NewGroupDialog: React.FC<NewGroupDialogProps> = ({ onClose, onCreated, onAction }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<CPType>('AC');
    const [strategy, setStrategy] = useState<LbStrategy>('round_robin');
    const [busy, setBusy] = useState(false);

    const submit = async (): Promise<void> => {
        if (!name.trim()) return;
        setBusy(true);
        try {
            const g = await fleetApi.createGroup({ name: name.trim(), type, lb_strategy: strategy, lb_enabled: true });
            onAction(`group ${g.name} created`);
            onCreated();
            onClose();
        } catch (err: any) {
            onAction(`create group failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <DialogShell title="New group" onClose={onClose}>
            <Field label="Name">
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. AC-Main"
                    autoFocus
                    style={inputStyle}
                />
            </Field>
            <Field label="Type">
                <select value={type} onChange={(e) => setType(e.target.value as CPType)} style={inputStyle}>
                    <option value="AC">AC (Type 2, 1 connector / CP)</option>
                    <option value="DC">DC (CCS, 2 connectors / CP)</option>
                </select>
            </Field>
            <Field label="LB strategy">
                <select value={strategy} onChange={(e) => setStrategy(e.target.value as LbStrategy)} style={inputStyle}>
                    <option value="round_robin">round_robin</option>
                    <option value="least_active">least_active</option>
                </select>
            </Field>
            <DialogActions>
                <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>Create</button>
            </DialogActions>
        </DialogShell>
    );
};

// ---- Shared shell components for both dialogs ----

interface DialogShellProps {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}

export const DialogShell: React.FC<DialogShellProps> = ({ title, onClose, children }) => (
    <div
        onClick={onClose}
        style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
        }}
    >
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                background: 'var(--bg-secondary, #1f2937)',
                color: 'var(--text-primary, white)',
                padding: '1.5rem',
                borderRadius: '8px',
                minWidth: '360px',
                maxWidth: '90vw',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            }}
        >
            <h2 style={{ marginTop: 0 }}>{title}</h2>
            {children}
        </div>
    </div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label style={{ display: 'block', marginBottom: '0.75rem' }}>
        <span style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {label}
        </span>
        {children}
    </label>
);

export const DialogActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
        {children}
    </div>
);

export const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid var(--bg-tertiary, #374151)',
    background: 'var(--bg-primary, #111827)',
    color: 'var(--text-primary, white)',
    boxSizing: 'border-box',
};
