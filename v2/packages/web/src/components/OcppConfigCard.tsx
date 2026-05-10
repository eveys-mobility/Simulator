import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, RotateCw, Search, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface Props {
    deviceId: string;
}

interface ConfigKey {
    key: string;
    value: string;
    readonly: boolean;
    type: 'string' | 'int' | 'bool' | 'csl';
    default: string;
    rebootRequired: boolean;
    description: string | null;
}

type WriteStatus = 'Accepted' | 'Rejected' | 'NotSupported' | 'RebootRequired';

/**
 * OCPP configuration table for one device. Mirrors what a CSMS sees
 * over GetConfiguration / ChangeConfiguration. Each row is a key:
 *   - readonly keys render as plain text with a lock badge
 *   - bool keys get a true/false dropdown
 *   - int keys get a number input
 *   - csl/string keys get a free text input
 *
 * Save fires a PUT and shows the wire status (Accepted, Rejected,
 * NotSupported, RebootRequired) as an inline badge that fades after
 * a few seconds.
 */
export function OcppConfigCard({ deviceId }: Props) {
    const qc = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['device-config', deviceId],
        queryFn: () => api.getDeviceConfig(deviceId),
    });
    const [filter, setFilter] = useState('');
    const keys = data?.keys ?? [];

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return keys;
        return keys.filter(
            (k) =>
                k.key.toLowerCase().includes(q) ||
                k.value.toLowerCase().includes(q) ||
                (k.description?.toLowerCase().includes(q) ?? false),
        );
    }, [keys, filter]);

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 gap-2 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                    <Settings2 className="h-4 w-4" /> OCPP configuration
                    <span className="text-xs font-normal text-muted-foreground">
                        {filtered.length}
                        {filter && filtered.length !== keys.length && ` of ${keys.length}`}
                    </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Filter…"
                            className="h-8 w-44 pl-7 text-xs"
                        />
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => qc.invalidateQueries({ queryKey: ['device-config', deviceId] })}
                        title="Refresh"
                    >
                        <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {isLoading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
                ) : filtered.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        {keys.length === 0
                            ? 'No configuration keys found.'
                            : 'No keys match the filter.'}
                    </div>
                ) : (
                    <ul className="divide-y divide-border/50 border-t">
                        {filtered.map((k) => (
                            <ConfigRow key={k.key} deviceId={deviceId} entry={k} />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

function ConfigRow({ deviceId, entry }: { deviceId: string; entry: ConfigKey }) {
    const qc = useQueryClient();
    const [draft, setDraft] = useState(entry.value);
    const [status, setStatus] = useState<WriteStatus | null>(null);

    // Reset draft + clear status when the underlying value changes
    // (e.g. another tab edited it, or refresh).
    useEffect(() => {
        setDraft(entry.value);
        setStatus(null);
    }, [entry.value]);

    // Auto-clear the status badge after a few seconds so the row
    // doesn't stay green / yellow forever.
    useEffect(() => {
        if (!status || status === 'Rejected' || status === 'NotSupported') return;
        const id = setTimeout(() => setStatus(null), 4000);
        return () => clearTimeout(id);
    }, [status]);

    const save = useMutation({
        mutationFn: (value: string) => api.setDeviceConfig(deviceId, entry.key, value),
        onSuccess: (res) => {
            setStatus(res.status);
            // Refetch so the row reflects whatever the backend stored
            // (Rejected leaves the value untouched, but querying back
            // keeps the cache honest if multiple tabs edited at once).
            qc.invalidateQueries({ queryKey: ['device-config', deviceId] });
        },
    });

    const dirty = draft !== entry.value;
    const handleSave = () => save.mutate(draft);
    const handleReset = () => setDraft(entry.value);

    return (
        <li className="px-3 py-2 flex items-start gap-3">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium truncate">{entry.key}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{entry.type}</Badge>
                    {entry.readonly && (
                        <Badge
                            variant="outline"
                            className="text-[10px] gap-1 bg-secondary/40"
                            title="Read-only — not writable by the CSMS or this UI"
                        >
                            <Lock className="h-2.5 w-2.5" /> read-only
                        </Badge>
                    )}
                    {entry.rebootRequired && !entry.readonly && (
                        <Badge
                            variant="outline"
                            className="text-[10px] gap-1 bg-amber-500/10 text-amber-600 border-amber-500/30"
                            title="Changes take effect after a reboot"
                        >
                            <AlertTriangle className="h-2.5 w-2.5" /> reboot
                        </Badge>
                    )}
                    {status && <StatusBadge status={status} />}
                </div>
                {entry.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
                )}
                {!entry.readonly && entry.default && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        default: <span className="font-mono">{entry.default}</span>
                    </p>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0 w-[260px]">
                {entry.readonly ? (
                    <span className="font-mono text-sm text-muted-foreground truncate w-full text-right">
                        {entry.value || <em className="text-muted-foreground/60">(empty)</em>}
                    </span>
                ) : (
                    <ConfigInput entry={entry} value={draft} onChange={setDraft} />
                )}
            </div>
            {!entry.readonly && (
                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReset}
                        disabled={!dirty || save.isPending}
                        title="Discard changes"
                    >
                        Reset
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
                        {save.isPending ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            )}
        </li>
    );
}

function ConfigInput({
    entry,
    value,
    onChange,
}: {
    entry: ConfigKey;
    value: string;
    onChange: (v: string) => void;
}) {
    if (entry.type === 'bool') {
        return (
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
                <option value="true">true</option>
                <option value="false">false</option>
            </select>
        );
    }
    if (entry.type === 'int') {
        return (
            <Input
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 w-full font-mono text-sm tabular-nums"
            />
        );
    }
    return (
        <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full font-mono text-xs"
            placeholder={entry.type === 'csl' ? 'comma,separated,list' : ''}
        />
    );
}

function StatusBadge({ status }: { status: WriteStatus }) {
    if (status === 'Accepted') {
        return (
            <Badge variant="outline" className="text-[10px] gap-1 bg-brand-green/15 text-brand-green border-brand-green/30">
                <Check className="h-2.5 w-2.5" /> Accepted
            </Badge>
        );
    }
    if (status === 'RebootRequired') {
        return (
            <Badge variant="outline" className="text-[10px] gap-1 bg-amber-500/15 text-amber-600 border-amber-500/30">
                <AlertTriangle className="h-2.5 w-2.5" /> Reboot required
            </Badge>
        );
    }
    if (status === 'Rejected') {
        return (
            <Badge variant="destructive" className="text-[10px]">Rejected</Badge>
        );
    }
    return (
        <Badge variant="outline" className="text-[10px] bg-secondary/40">NotSupported</Badge>
    );
}

