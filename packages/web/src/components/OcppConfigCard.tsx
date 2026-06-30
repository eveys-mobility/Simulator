import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, RotateCw, Save, Search, Settings2 } from 'lucide-react';
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
 *  - readonly keys render as plain text with a lock badge
 *  - bool keys get a true/false dropdown
 *  - int keys get a number input
 *  - csl/string keys get a free text input
 *
 * The card hoists draft + status state so a "Save all" header button
 * can flush every dirty row in one round trip — useful during CSMS
 * conformance work where flipping 4–6 keys back-to-back is normal.
 */
export function OcppConfigCard({ deviceId }: Props) {
    const qc = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['device-config', deviceId],
        queryFn: () => api.getDeviceConfig(deviceId),
    });
    const [filter, setFilter] = useState('');
    /** Per-key draft. Only present when the row is dirty (draft !== server value). */
    const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
    /** Per-key last-write status. Pruned when the row goes clean again. */
    const [statuses, setStatuses] = useState<Map<string, WriteStatus>>(() => new Map());
    /** Result summary from the most recent Save-all. Populated only by
     *  bulk save (per-row Save reuses the row badge). Fades after 5s. */
    const [lastBulkSummary, setLastBulkSummary] = useState<{
        accepted: number;
        rejected: number;
        rebootRequired: number;
        notSupported: number;
        at: number;
    } | null>(null);

    const keys = data?.keys ?? [];

    // When the server data changes (refetch / WS-triggered invalidation),
    // drop any drafts whose value now matches the server — the row went
    // clean from under us. Keeps the dirty count honest.
    useEffect(() => {
        setDrafts((prev) => {
            const next = new Map(prev);
            let changed = false;
            for (const k of keys) {
                if (next.get(k.key) === k.value) {
                    next.delete(k.key);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [keys]);

    // Fade Accepted / RebootRequired statuses after a few seconds; keep
    // Rejected and NotSupported until the user retries.
    useEffect(() => {
        if (statuses.size === 0) return;
        const id = setTimeout(() => {
            setStatuses((prev) => {
                const next = new Map(prev);
                let changed = false;
                for (const [k, s] of prev) {
                    if (s === 'Accepted' || s === 'RebootRequired') {
                        next.delete(k);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, 4000);
        return () => clearTimeout(id);
    }, [statuses]);

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

    const setDraft = (key: string, value: string, serverValue: string) => {
        setDrafts((prev) => {
            const next = new Map(prev);
            if (value === serverValue) next.delete(key);
            else next.set(key, value);
            return next;
        });
        // Clear an old per-row status the moment the user resumes typing.
        setStatuses((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
    };

    const resetDraft = (key: string) => {
        setDrafts((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
        setStatuses((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
    };

    const recordResults = (
        results: Array<{ key: string; status: WriteStatus; value: string }>,
        serverValueFor: (key: string) => string | undefined,
    ) => {
        setStatuses((prev) => {
            const next = new Map(prev);
            for (const r of results) next.set(r.key, r.status);
            return next;
        });
        // Clear drafts for keys the server now stores at the draft value
        // (Accepted / RebootRequired). Rejected/NotSupported leave the
        // draft in place so the user can fix and retry.
        setDrafts((prev) => {
            const next = new Map(prev);
            for (const r of results) {
                const sv = serverValueFor(r.key);
                if (r.status === 'Accepted' || r.status === 'RebootRequired') {
                    if (next.get(r.key) === r.value || next.get(r.key) === sv) next.delete(r.key);
                }
            }
            return next;
        });
    };

    const saveOne = useMutation({
        mutationFn: ({ key, value }: { key: string; value: string }) =>
            api.setDeviceConfig(deviceId, key, value),
        onSuccess: (res) => {
            recordResults([res], (k) => keys.find((x) => x.key === k)?.value);
            qc.invalidateQueries({ queryKey: ['device-config', deviceId] });
        },
    });

    const saveAll = useMutation({
        mutationFn: (changes: Record<string, string>) => api.setDeviceConfigBulk(deviceId, changes),
        onSuccess: (res) => {
            recordResults(res.results, (k) => keys.find((x) => x.key === k)?.value);
            qc.invalidateQueries({ queryKey: ['device-config', deviceId] });
            // Tally per-status counts for the header pill.
            let accepted = 0;
            let rejected = 0;
            let rebootRequired = 0;
            let notSupported = 0;
            for (const r of res.results) {
                if (r.status === 'Accepted') accepted += 1;
                else if (r.status === 'Rejected') rejected += 1;
                else if (r.status === 'RebootRequired') rebootRequired += 1;
                else if (r.status === 'NotSupported') notSupported += 1;
            }
            setLastBulkSummary({
                accepted,
                rejected,
                rebootRequired,
                notSupported,
                at: Date.now(),
            });
        },
    });

    // Fade the bulk summary pill after 5s. Using lastBulkSummary.at as
    // the dep so each new save resets the timer.
    useEffect(() => {
        if (!lastBulkSummary) return;
        const id = setTimeout(() => setLastBulkSummary(null), 5000);
        return () => clearTimeout(id);
    }, [lastBulkSummary]);

    const dirtyCount = drafts.size;
    const handleSaveAll = () => {
        if (dirtyCount === 0) return;
        const changes: Record<string, string> = {};
        for (const [k, v] of drafts) changes[k] = v;
        saveAll.mutate(changes);
    };

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 gap-2 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                    <Settings2 className="h-4 w-4" /> OCPP configuration
                    <span className="text-xs font-normal text-muted-foreground">
                        {filtered.length}
                        {filter && filtered.length !== keys.length && ` of ${keys.length}`}
                    </span>
                    {dirtyCount > 0 && (
                        <Badge
                            variant="outline"
                            className="text-[10px] gap-1 bg-amber-500/15 text-amber-600 border-amber-500/30"
                        >
                            {dirtyCount} unsaved
                        </Badge>
                    )}
                    {lastBulkSummary && <BulkSummaryBadge summary={lastBulkSummary} />}
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
                        onClick={() =>
                            qc.invalidateQueries({ queryKey: ['device-config', deviceId] })
                        }
                        title="Refresh"
                        disabled={saveAll.isPending}
                    >
                        <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSaveAll}
                        disabled={dirtyCount === 0 || saveAll.isPending || saveOne.isPending}
                    >
                        <Save className="h-3.5 w-3.5" />
                        {saveAll.isPending
                            ? 'Saving…'
                            : `Save all${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
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
                        {filtered.map((k) => {
                            const draft = drafts.get(k.key);
                            const status = statuses.get(k.key) ?? null;
                            return (
                                <ConfigRow
                                    key={k.key}
                                    entry={k}
                                    draft={draft ?? k.value}
                                    dirty={draft !== undefined}
                                    status={status}
                                    onChange={(v) => setDraft(k.key, v, k.value)}
                                    onReset={() => resetDraft(k.key)}
                                    onSave={() =>
                                        saveOne.mutate({ key: k.key, value: draft ?? k.value })
                                    }
                                    saving={saveOne.isPending || saveAll.isPending}
                                />
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

interface RowProps {
    entry: ConfigKey;
    draft: string;
    dirty: boolean;
    status: WriteStatus | null;
    onChange: (v: string) => void;
    onReset: () => void;
    onSave: () => void;
    saving: boolean;
}

function ConfigRow({ entry, draft, dirty, status, onChange, onReset, onSave, saving }: RowProps) {
    return (
        <li className="px-3 py-2 flex items-start gap-3">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium truncate">{entry.key}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                        {entry.type}
                    </Badge>
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
                    <ConfigInput entry={entry} value={draft} onChange={onChange} />
                )}
            </div>
            {!entry.readonly && (
                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onReset}
                        disabled={!dirty || saving}
                        title="Discard changes"
                    >
                        Reset
                    </Button>
                    <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
                        {saving ? 'Saving…' : 'Save'}
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

function BulkSummaryBadge({
    summary,
}: {
    summary: { accepted: number; rejected: number; rebootRequired: number; notSupported: number };
}) {
    const failed = summary.rejected + summary.notSupported;
    const ok = summary.accepted + summary.rebootRequired;
    // Tone the badge by the worst outcome in the batch — green when
    // everything was Accepted, amber when at least one needs a reboot,
    // red when anything was Rejected/NotSupported. Operator gets the
    // "did this work?" answer in one glance.
    const tone =
        failed > 0
            ? 'bg-destructive/15 text-destructive border-destructive/30'
            : summary.rebootRequired > 0
              ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
              : 'bg-brand-green/15 text-brand-green border-brand-green/30';
    const Icon = failed > 0 ? AlertTriangle : summary.rebootRequired > 0 ? AlertTriangle : Check;
    const parts: string[] = [];
    if (ok > 0) parts.push(`${ok} saved`);
    if (summary.rejected > 0) parts.push(`${summary.rejected} rejected`);
    if (summary.notSupported > 0) parts.push(`${summary.notSupported} not supported`);
    if (summary.rebootRequired > 0) parts.push(`${summary.rebootRequired} need reboot`);
    return (
        <Badge variant="outline" className={`text-[10px] gap-1 ${tone}`}>
            <Icon className="h-2.5 w-2.5" />
            {parts.join(' · ')}
        </Badge>
    );
}

function StatusBadge({ status }: { status: WriteStatus }) {
    if (status === 'Accepted') {
        return (
            <Badge
                variant="outline"
                className="text-[10px] gap-1 bg-brand-green/15 text-brand-green border-brand-green/30"
            >
                <Check className="h-2.5 w-2.5" /> Accepted
            </Badge>
        );
    }
    if (status === 'RebootRequired') {
        return (
            <Badge
                variant="outline"
                className="text-[10px] gap-1 bg-amber-500/15 text-amber-600 border-amber-500/30"
            >
                <AlertTriangle className="h-2.5 w-2.5" /> Reboot required
            </Badge>
        );
    }
    if (status === 'Rejected') {
        return (
            <Badge variant="destructive" className="text-[10px]">
                Rejected
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="text-[10px] bg-secondary/40">
            NotSupported
        </Badge>
    );
}
