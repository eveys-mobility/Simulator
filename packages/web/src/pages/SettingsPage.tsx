import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw, Save, Trash, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type DeviceWithRuntime } from '@/lib/api';
import { useLiveStore } from '@/lib/live-store';

export function SettingsPage() {
    const qc = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['settings'],
        queryFn: api.getSettings,
    });

    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // Seed the input once data lands; later refetches don't clobber an
    // in-progress edit.
    useEffect(() => {
        if (data && draft === '') setDraft(data.defaultOcppUrl);
    }, [data, draft]);

    const save = useMutation({
        mutationFn: (defaultOcppUrl: string) => api.updateSettings({ defaultOcppUrl }),
        onSuccess: (res) => {
            setError(null);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            setDraft(res.defaultOcppUrl);
            qc.invalidateQueries({ queryKey: ['settings'] });
        },
        onError: (e) => {
            setError(e instanceof Error ? e.message : String(e));
            setSaved(false);
        },
    });

    // Enable Save whenever the field holds a syntactically valid URL,
    // regardless of whether it differs from the persisted value. The
    // server is idempotent, and "always clickable when valid" is less
    // confusing than a button that reports "no change to save" via a
    // disabled state that the user has to reverse-engineer.
    const trimmed = draft.trim();
    let isValidUrl = false;
    try {
        if (trimmed) {
            new URL(trimmed);
            isValidUrl = true;
        }
    } catch {
        isValidUrl = false;
    }
    const canSave = !isLoading && isValidUrl && !save.isPending;

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="text-2xl font-semibold">Settings</h1>
                <p className="text-sm text-muted-foreground">
                    Simulator-wide preferences. Per-device options live on each device's edit
                    dialog.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">OCPP gateway</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        New devices connect to this WebSocket URL by default. Existing devices keep
                        their own URL until you edit them — this only affects the next device you
                        create.
                    </p>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!isValidUrl) {
                                setError('Enter a valid URL (e.g. ws://gateway.example:19000)');
                                return;
                            }
                            save.mutate(trimmed);
                        }}
                        className="space-y-2"
                    >
                        <Label htmlFor="default-ocpp-url">Default OCPP URL</Label>
                        <div className="flex gap-2">
                            <Input
                                id="default-ocpp-url"
                                type="url"
                                value={isLoading ? 'loading…' : draft}
                                onChange={(e) => {
                                    setDraft(e.target.value);
                                    setError(null);
                                }}
                                placeholder="ws://gateway.example:19000"
                                disabled={isLoading || save.isPending}
                                className="font-mono text-sm"
                            />
                            <Button type="submit" disabled={!canSave}>
                                <Save className="h-4 w-4" />
                                {save.isPending ? 'Saving…' : 'Save'}
                            </Button>
                        </div>

                        {saved && <p className="text-sm text-brand-green">Saved.</p>}
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </form>
                </CardContent>
            </Card>

            <DeletedDevicesCard />

            <ResetDatabaseCard />
        </div>
    );
}

type DeletedDevice = DeviceWithRuntime & { deletedAt: string };

function DeletedDevicesCard() {
    const qc = useQueryClient();
    const resetLiveDevice = useLiveStore((s) => s.reset);
    const setOnline = useLiveStore((s) => s.setOnline);
    const { data, isLoading } = useQuery({
        queryKey: ['deleted-devices'],
        queryFn: api.listDeletedDevices,
    });
    const [purgeTarget, setPurgeTarget] = useState<DeletedDevice | null>(null);

    const restore = useMutation({
        mutationFn: api.restoreDevice,
        onSuccess: (restored) => {
            // Seed the live store with the device's current online state
            // straight from the server response. Without this the row
            // briefly shows "Offline" between the next /devices refetch
            // landing and the WS 'state' push that flips it — a 1-frame
            // flicker the user sees as a stale indicator on /devices.
            setOnline(restored.id, restored.online);
            // Optimistically prepend the device into the cached list so
            // a navigation to /devices right after Restore renders the
            // row immediately, not after the refetch round-trip.
            qc.setQueryData<DeviceWithRuntime[]>(['devices'], (prev) =>
                prev && !prev.find((d) => d.id === restored.id) ? [...prev, restored] : prev,
            );
            qc.invalidateQueries({ queryKey: ['deleted-devices'] });
            qc.invalidateQueries({ queryKey: ['devices'] });
        },
    });
    const purge = useMutation({
        mutationFn: api.purgeDevice,
        onSuccess: (_data, deviceId) => {
            qc.invalidateQueries({ queryKey: ['deleted-devices'] });
            qc.invalidateQueries({ queryKey: ['sessions'] });
            resetLiveDevice(deviceId);
            setPurgeTarget(null);
        },
    });

    const list = data ?? [];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Trash className="h-4 w-4" /> Deleted devices
                    {list.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                            {list.length}
                        </Badge>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Soft-deleted devices stay here so their session history is preserved. Restore
                    brings the device back to the live fleet; purge permanently removes it and{' '}
                    <span className="font-medium text-destructive">
                        drops every session it ever ran
                    </span>
                    .
                </p>
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No deleted devices.</p>
                ) : (
                    <ul className="divide-y divide-border/50 rounded-md border">
                        {list.map((d) => (
                            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                                <Badge variant={d.type === 'DC' ? 'dc' : 'ac'}>{d.type}</Badge>
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium truncate">{d.displayName}</div>
                                    <div className="font-mono text-xs text-muted-foreground truncate">
                                        {d.id}
                                    </div>
                                </div>
                                <span className="hidden sm:block text-xs text-muted-foreground">
                                    deleted {new Date(d.deletedAt).toLocaleString()}
                                </span>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => restore.mutate(d.id)}
                                        disabled={restore.isPending}
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        Restore
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => setPurgeTarget(d)}
                                        disabled={purge.isPending}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Purge
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>

            <ConfirmDialog
                open={purgeTarget !== null}
                onOpenChange={(o) => {
                    if (!o) setPurgeTarget(null);
                }}
                title="Purge device permanently"
                description={
                    purgeTarget ? (
                        <>
                            Permanently remove{' '}
                            <span className="font-medium text-foreground">
                                {purgeTarget.displayName}
                            </span>{' '}
                            <span className="font-mono text-xs text-muted-foreground">
                                ({purgeTarget.id})
                            </span>{' '}
                            and every session it ever ran. This cannot be undone — type the word
                            below if you really mean it.
                        </>
                    ) : null
                }
                confirmText="Purge forever"
                destructive
                typedConfirmation="PURGE"
                pending={purge.isPending}
                onConfirm={() => {
                    if (purgeTarget) purge.mutate(purgeTarget.id);
                }}
            />
        </Card>
    );
}

function ResetDatabaseCard() {
    const qc = useQueryClient();
    const [typed, setTyped] = useState('');
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = useMutation({
        mutationFn: () => api.resetDatabase(),
        onSuccess: () => {
            setDone(true);
            setTyped('');
            setError(null);
            // Wipe every cached query so the UI snaps back to empty state.
            qc.invalidateQueries();
            setTimeout(() => setDone(false), 4000);
        },
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });

    const armed = typed === 'DELETE';

    return (
        <Card className="border-destructive/40">
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" /> Danger zone
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Reset the database. Every device, session, OCPP-config row and app setting is
                    dropped. Running OCPP connections are torn down. The OCPP gateway URL falls back
                    to the
                    <code className="mx-1 px-1 py-0.5 rounded bg-secondary/40 text-foreground">
                        OCPP_URL
                    </code>
                    env var, or{' '}
                    <code className="mx-1 px-1 py-0.5 rounded bg-secondary/40 text-foreground">
                        ws://localhost:19000
                    </code>
                    if unset.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1">
                        <Label htmlFor="reset-confirm" className="text-xs text-muted-foreground">
                            Type{' '}
                            <span className="font-mono font-bold text-destructive">DELETE</span> to
                            confirm
                        </Label>
                        <Input
                            id="reset-confirm"
                            value={typed}
                            onChange={(e) => {
                                setTyped(e.target.value);
                                setError(null);
                            }}
                            placeholder="DELETE"
                            className="font-mono"
                        />
                    </div>
                    <Button
                        variant="destructive"
                        disabled={!armed || reset.isPending}
                        onClick={() => reset.mutate()}
                    >
                        <Trash2 className="h-4 w-4" />
                        {reset.isPending ? 'Resetting…' : 'Reset database'}
                    </Button>
                </div>
                {done && <p className="text-sm text-brand-green">Database reset.</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
        </Card>
    );
}
