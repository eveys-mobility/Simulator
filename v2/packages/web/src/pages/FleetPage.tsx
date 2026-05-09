import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertOctagon,
    Activity,
    Cpu,
    PlayCircle,
    Plus,
    RefreshCw,
    Timer,
    Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import type { DeviceType } from '@ocpp-sim/core';

export function FleetPage() {
    const qc = useQueryClient();

    const summary = useQuery({
        queryKey: ['fleet-summary'],
        queryFn: api.fleetSummary,
        // The summary moves with every state change. WS already invalidates
        // ['devices']; refetch this on the same WS-triggered window-focus
        // schedule plus a 5s interval as a safety net for state events
        // we don't directly observe (sessions started by our own actions).
        refetchInterval: 5000,
    });

    const invalidateAll = () => {
        qc.invalidateQueries({ queryKey: ['devices'] });
        qc.invalidateQueries({ queryKey: ['fleet-summary'] });
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Fleet operations</h1>
                <p className="text-sm text-muted-foreground">
                    Bulk create devices and drive the whole fleet at once.
                </p>
            </div>

            {/* Live counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat
                    label="Total devices"
                    value={summary.data?.total ?? '—'}
                    icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
                />
                <Stat
                    label="Online"
                    value={summary.data?.online ?? '—'}
                    icon={<Activity className="h-4 w-4 text-brand-green" />}
                    accent="text-brand-green"
                />
                <Stat
                    label="Offline"
                    value={summary.data?.offline ?? '—'}
                    icon={<Activity className="h-4 w-4 text-muted-foreground" />}
                />
                <Stat
                    label="Charging"
                    value={summary.data?.chargingConnectors ?? '—'}
                    icon={<Zap className="h-4 w-4 text-brand-orange" />}
                    accent="text-brand-orange"
                />
            </div>

            <BulkCreateCard onSuccess={invalidateAll} />
            <FleetActionsCard onSuccess={invalidateAll} />
        </div>
    );
}

function Stat({
    label,
    value,
    icon,
    accent,
}: {
    label: string;
    value: number | string;
    icon: React.ReactNode;
    accent?: string;
}) {
    return (
        <Card>
            <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                    <div className={`text-2xl font-semibold tabular-nums ${accent ?? ''}`}>{value}</div>
                </div>
                {icon}
            </CardContent>
        </Card>
    );
}

function BulkCreateCard({ onSuccess }: { onSuccess: () => void }) {
    const [count, setCount] = useState(10);
    const [type, setType] = useState<DeviceType>('AC');
    const [namePrefix, setNamePrefix] = useState('Bulk AC');
    const [error, setError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<{ created: number } | null>(null);

    const create = useMutation({
        mutationFn: () =>
            api.bulkCreateDevices({
                count,
                type,
                namePrefix: namePrefix.trim() || undefined,
            }),
        onSuccess: (res) => {
            setError(null);
            setLastResult({ created: res.created });
            onSuccess();
        },
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Bulk create
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    Spawns N devices with a 200 ms stagger so the gateway sees them as a steady stream rather
                    than a thundering herd. Cap is 200 per call.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <div className="space-y-1.5">
                        <Label htmlFor="bulk-count" className="text-xs text-muted-foreground">Count</Label>
                        <Input
                            id="bulk-count"
                            type="number"
                            value={count}
                            onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                            min={1}
                            max={200}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Type</Label>
                        <Select value={type} onValueChange={(v) => setType(v as DeviceType)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="AC">AC</SelectItem>
                                <SelectItem value="DC">DC</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="bulk-name" className="text-xs text-muted-foreground">Name prefix</Label>
                        <Input
                            id="bulk-name"
                            value={namePrefix}
                            onChange={(e) => setNamePrefix(e.target.value)}
                            placeholder="Bulk AC"
                        />
                    </div>
                </div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <Button onClick={() => create.mutate()} disabled={create.isPending}>
                        <Plus className="h-4 w-4" />
                        {create.isPending ? `Creating ${count}…` : `Create ${count} ${type}`}
                    </Button>
                    {lastResult && (
                        <span className="text-sm text-brand-green">Created {lastResult.created} device(s).</span>
                    )}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
        </Card>
    );
}

function FleetActionsCard({ onSuccess }: { onSuccess: () => void }) {
    const [fraction, setFraction] = useState(50); // percent
    const [hbSeconds, setHbSeconds] = useState(300);
    const [feedback, setFeedback] = useState<string | null>(null);

    const flash = (s: string) => {
        setFeedback(s);
        setTimeout(() => setFeedback((curr) => (curr === s ? null : curr)), 4000);
    };

    const startFraction = useMutation({
        mutationFn: () => api.fleetStartFraction({ fraction: fraction / 100 }),
        onSuccess: (r) => {
            flash(`Started ${r.started} / picked ${r.picked} / eligible ${r.eligible}.`);
            onSuccess();
        },
    });

    const reconnect = useMutation({
        mutationFn: () => api.fleetReconnect(),
        onSuccess: (r) => {
            flash(`Reconnecting ${r.reconnecting} device(s).`);
            onSuccess();
        },
    });

    const hb = useMutation({
        mutationFn: () => api.fleetHeartbeatInterval(hbSeconds),
        onSuccess: (r) => flash(`HeartbeatInterval = ${r.seconds}s on ${r.updated} device(s).`),
    });

    const eStop = useMutation({
        mutationFn: () => api.fleetEmergencyStop(),
        onSuccess: (r) => {
            flash(`Emergency-stopped ${r.stopped} device(s).`);
            onSuccess();
        },
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4" /> Fleet operations
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Start fraction */}
                <Section title="Start sessions">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="frac" className="text-xs text-muted-foreground">
                                Fraction of eligible connectors
                            </Label>
                            <div className="flex items-center gap-2">
                                <input
                                    id="frac"
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={fraction}
                                    onChange={(e) => setFraction(Number(e.target.value))}
                                    className="w-40 accent-brand-orange"
                                />
                                <span className="font-mono text-sm tabular-nums w-10 text-right">{fraction}%</span>
                            </div>
                        </div>
                        <Button onClick={() => startFraction.mutate()} disabled={startFraction.isPending}>
                            <PlayCircle className="h-4 w-4" />
                            Start {fraction}%
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Picks a random subset of online + Available connectors (no active session) and starts a
                        session on each.
                    </p>
                </Section>

                <Separator />

                <Section title="Reconnect storm">
                    <Button
                        variant="outline"
                        onClick={() => reconnect.mutate()}
                        disabled={reconnect.isPending}
                    >
                        <RefreshCw className="h-4 w-4" />
                        Reconnect all
                    </Button>
                    <p className="text-xs text-muted-foreground">
                        Closes every device's WebSocket. Each reconnects with exponential backoff — useful for
                        stress-testing the gateway's recovery path.
                    </p>
                </Section>

                <Separator />

                <Section title="Heartbeat interval">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="hb" className="text-xs text-muted-foreground">
                                Seconds (pushes ChangeConfiguration to every device)
                            </Label>
                            <Input
                                id="hb"
                                type="number"
                                value={hbSeconds}
                                onChange={(e) => setHbSeconds(Math.max(1, Number(e.target.value) || 1))}
                                min={1}
                                max={86400}
                                className="w-32"
                            />
                        </div>
                        <Button onClick={() => hb.mutate()} disabled={hb.isPending}>
                            <Timer className="h-4 w-4" />
                            Apply
                        </Button>
                    </div>
                </Section>

                <Separator />

                <Section title="Emergency stop">
                    <Button
                        variant="destructive"
                        onClick={() => {
                            if (confirm('Emergency-stop every connector on every device?')) eStop.mutate();
                        }}
                        disabled={eStop.isPending}
                    >
                        <AlertOctagon className="h-4 w-4" />
                        Emergency stop all
                    </Button>
                    <p className="text-xs text-muted-foreground">
                        Faults every connector and aborts any active session with reason=EmergencyStop. Recovery
                        requires clearing each fault individually from the device page.
                    </p>
                </Section>

                {feedback && (
                    <div className="rounded-md border border-brand-green/40 bg-brand-green/10 p-3 text-sm text-brand-green">
                        {feedback}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
            <div className="flex flex-col gap-2">{children}</div>
        </div>
    );
}
