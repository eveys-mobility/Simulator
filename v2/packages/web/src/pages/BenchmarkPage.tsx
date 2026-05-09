import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CheckCircle2,
    ExternalLink,
    History,
    PlayCircle,
    Sparkles,
    StopCircle,
    XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useLiveStore } from '@/lib/live-store';
import { type BenchmarkRun, type Scenario, ScenarioSchema } from '@ocpp-sim/core';

// Light wrapper around `Scenario` for the form. Numbers are kept as
// strings because <input type="number"> emits empty string on backspace
// and we want to keep that visible.
interface FormState {
    name: string;
    deviceCount: string;
    deviceMix: 'AC' | 'DC' | 'mixed';
    acFraction: string;
    rampUpSeconds: string;
    sessionsPerHourPerDevice: string;
    sessionDurationSeconds: string;
    meterValueIntervalSeconds: string;
    totalDurationSeconds: string;
    autoCleanup: boolean;
    ocppUrl: string;
}

const initialForm: FormState = {
    name: 'Custom run',
    deviceCount: '10',
    deviceMix: 'AC',
    acFraction: '1',
    rampUpSeconds: '5',
    sessionsPerHourPerDevice: '6',
    sessionDurationSeconds: '30',
    meterValueIntervalSeconds: '10',
    totalDurationSeconds: '120',
    autoCleanup: true,
    ocppUrl: '',
};

function scenarioFromForm(f: FormState): Scenario {
    const raw = {
        name: f.name.trim(),
        deviceCount: Number(f.deviceCount),
        deviceMix: f.deviceMix,
        acFraction: Number(f.acFraction),
        rampUpSeconds: Number(f.rampUpSeconds),
        sessionsPerHourPerDevice: Number(f.sessionsPerHourPerDevice),
        sessionDurationSeconds: Number(f.sessionDurationSeconds),
        meterValueIntervalSeconds: Number(f.meterValueIntervalSeconds),
        totalDurationSeconds: Number(f.totalDurationSeconds),
        autoCleanup: f.autoCleanup,
        ocppUrl: f.ocppUrl.trim() || undefined,
    };
    return ScenarioSchema.parse(raw);
}

function formFromScenario(s: Scenario): FormState {
    return {
        name: s.name,
        deviceCount: String(s.deviceCount),
        deviceMix: s.deviceMix,
        acFraction: String(s.acFraction),
        rampUpSeconds: String(s.rampUpSeconds),
        sessionsPerHourPerDevice: String(s.sessionsPerHourPerDevice),
        sessionDurationSeconds: String(s.sessionDurationSeconds),
        meterValueIntervalSeconds: String(s.meterValueIntervalSeconds),
        totalDurationSeconds: String(s.totalDurationSeconds),
        autoCleanup: s.autoCleanup,
        ocppUrl: s.ocppUrl ?? '',
    };
}

export function BenchmarkPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Benchmark</h1>
                <p className="text-sm text-muted-foreground">
                    Drive synthetic load against the OCPP gateway. Scenarios spawn <code className="font-mono text-xs">bench_*</code> devices,
                    run for a fixed duration, then clean up.
                </p>
            </div>

            <Tabs defaultValue="run">
                <TabsList>
                    <TabsTrigger value="metrics" className="gap-1.5">
                        <Activity className="h-3.5 w-3.5" /> Live metrics
                    </TabsTrigger>
                    <TabsTrigger value="run" className="gap-1.5">
                        <PlayCircle className="h-3.5 w-3.5" /> Run scenario
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-1.5">
                        <History className="h-3.5 w-3.5" /> History
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="metrics" className="mt-4">
                    <LiveMetricsTab />
                </TabsContent>
                <TabsContent value="run" className="mt-4">
                    <RunTab />
                </TabsContent>
                <TabsContent value="history" className="mt-4">
                    <HistoryTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function LiveMetricsTab() {
    const progressMap = useLiveStore((s) => s.benchmarkProgress);
    const latest = [...progressMap.values()].sort((a, b) => b.runId - a.runId)[0];
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Latest run</CardTitle>
                </CardHeader>
                <CardContent>
                    {latest ? (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <Stat label="Run id" value={`#${latest.runId}`} />
                            <Stat label="Elapsed" value={`${latest.t}s`} />
                            <Stat label="Online" value={latest.devicesOnline} />
                            <Stat label="Active sessions" value={latest.sessionsActive} />
                            <Stat label="Errors" value={latest.errors} accent={latest.errors > 0 ? 'text-destructive' : undefined} />
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            No active run. Start a scenario to see live counters here.
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" /> Grafana
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        For deeper analysis (rate, latency p99, per-action errors, frame throughput), open the Grafana stack.
                    </p>
                    <div className="flex gap-2">
                        <a href="http://localhost:3000" target="_blank" rel="noreferrer">
                            <Button variant="outline">
                                <ExternalLink className="h-3.5 w-3.5" /> Open Grafana
                            </Button>
                        </a>
                        <a href="http://localhost:9090" target="_blank" rel="noreferrer">
                            <Button variant="outline">
                                <ExternalLink className="h-3.5 w-3.5" /> Open Prometheus
                            </Button>
                        </a>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Bring the stack up with <code className="font-mono">cd v2 && docker compose up -d</code>.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

function RunTab() {
    const qc = useQueryClient();
    const [form, setForm] = useState<FormState>(initialForm);
    const [error, setError] = useState<string | null>(null);

    const presets = useQuery({
        queryKey: ['benchmark-presets'],
        queryFn: api.listBenchmarkPresets,
    });

    const start = useMutation({
        mutationFn: () => {
            try {
                return api.startBenchmarkRun(scenarioFromForm(form));
            } catch (e) {
                throw new Error(e instanceof Error ? e.message : String(e));
            }
        },
        onSuccess: () => {
            setError(null);
            qc.invalidateQueries({ queryKey: ['benchmark-runs'] });
        },
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });

    const progressMap = useLiveStore((s) => s.benchmarkProgress);
    const latestRunId = start.data?.id;
    const latest = latestRunId ? progressMap.get(latestRunId) : undefined;
    const running = latest && start.data?.status === 'running';

    const stop = useMutation({
        mutationFn: () => api.stopBenchmarkRun(latestRunId!),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['benchmark-runs'] }),
    });

    const set =
        <K extends keyof FormState>(k: K) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            setForm((f) => ({ ...f, [k]: e.target.value as FormState[K] }));

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4" /> Presets
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    {(presets.data ?? []).map((p) => (
                        <Button
                            key={p.key}
                            variant="outline"
                            size="sm"
                            onClick={() => setForm(formFromScenario(p.scenario))}
                        >
                            {p.label}
                        </Button>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Scenario</CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            start.mutate();
                        }}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                    >
                        <Field label="Name">
                            <Input value={form.name} onChange={set('name')} required maxLength={80} />
                        </Field>
                        <Field label="Device count">
                            <Input type="number" value={form.deviceCount} onChange={set('deviceCount')} min={1} max={500} />
                        </Field>
                        <Field label="Mix">
                            <Select
                                value={form.deviceMix}
                                onValueChange={(v) => setForm((f) => ({ ...f, deviceMix: v as FormState['deviceMix'] }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="AC">AC only</SelectItem>
                                    <SelectItem value="DC">DC only</SelectItem>
                                    <SelectItem value="mixed">Mixed</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="AC fraction (when Mixed)">
                            <Input
                                type="number"
                                value={form.acFraction}
                                onChange={set('acFraction')}
                                step="0.05"
                                min={0}
                                max={1}
                                disabled={form.deviceMix !== 'mixed'}
                            />
                        </Field>
                        <Field label="Ramp-up (s)">
                            <Input type="number" value={form.rampUpSeconds} onChange={set('rampUpSeconds')} min={0} max={3600} />
                        </Field>
                        <Field label="Sessions / hour / device">
                            <Input type="number" value={form.sessionsPerHourPerDevice} onChange={set('sessionsPerHourPerDevice')} step="0.1" min={0} max={60} />
                        </Field>
                        <Field label="Session duration (s)">
                            <Input type="number" value={form.sessionDurationSeconds} onChange={set('sessionDurationSeconds')} min={5} max={86400} />
                        </Field>
                        <Field label="MeterValue interval (s)">
                            <Input type="number" value={form.meterValueIntervalSeconds} onChange={set('meterValueIntervalSeconds')} min={1} max={3600} />
                        </Field>
                        <Field label="Total duration (s)">
                            <Input type="number" value={form.totalDurationSeconds} onChange={set('totalDurationSeconds')} min={10} max={86400} />
                        </Field>
                        <Field label="OCPP URL (override)">
                            <Input
                                value={form.ocppUrl}
                                onChange={set('ocppUrl')}
                                placeholder="(use default)"
                                className="font-mono text-sm"
                            />
                        </Field>
                        <label className="col-span-full inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.autoCleanup}
                                onChange={(e) => setForm((f) => ({ ...f, autoCleanup: e.target.checked }))}
                                className="h-4 w-4"
                            />
                            Auto-cleanup on completion
                        </label>

                        <div className="col-span-full flex items-center gap-2 pt-2">
                            <Button type="submit" disabled={start.isPending || !!running}>
                                <PlayCircle className="h-4 w-4" />
                                {start.isPending ? 'Starting…' : running ? 'Running…' : 'Start run'}
                            </Button>
                            {running && (
                                <Button type="button" variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
                                    <StopCircle className="h-4 w-4" /> Stop
                                </Button>
                            )}
                        </div>
                        {error && <p className="col-span-full text-sm text-destructive">{error}</p>}
                    </form>
                </CardContent>
            </Card>

            {latest && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Run #{latest.runId}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <Stat label="Elapsed" value={`${latest.t}s`} />
                            <Stat label="Devices online" value={latest.devicesOnline} />
                            <Stat label="Active sessions" value={latest.sessionsActive} accent="text-brand-orange" />
                            <Stat label="Sessions started" value={latest.sessionsStarted} />
                            <Stat
                                label="Errors"
                                value={latest.errors}
                                accent={latest.errors > 0 ? 'text-destructive' : undefined}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function HistoryTab() {
    const { data, isLoading } = useQuery({
        queryKey: ['benchmark-runs'],
        queryFn: () => api.listBenchmarkRuns({ limit: 50 }),
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    {isLoading ? 'Loading…' : `${data?.total ?? 0} run(s)`}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-4 py-2 text-left">Status</th>
                            <th className="px-4 py-2 text-left">Run</th>
                            <th className="px-4 py-2 text-left">Started</th>
                            <th className="px-4 py-2 text-right">Devices</th>
                            <th className="px-4 py-2 text-right">Sessions</th>
                            <th className="px-4 py-2 text-right">Errors</th>
                            <th className="px-4 py-2 text-right">Elapsed</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(data?.runs ?? []).map((r) => (
                            <RunRow key={r.id} run={r} />
                        ))}
                        {!isLoading && (data?.runs.length ?? 0) === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                                    No runs yet. Start one from the Run scenario tab.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}

function RunRow({ run }: { run: BenchmarkRun }) {
    return (
        <tr className="border-b last:border-b-0 hover:bg-secondary/30">
            <td className="px-4 py-2">
                <StatusBadge status={run.status} />
            </td>
            <td className="px-4 py-2">
                <Link to={`/benchmark/runs/${run.id}`} className="block group">
                    <div className="font-medium group-hover:text-brand-orange transition-colors">
                        {run.scenario.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        #{run.id} · {run.scenario.deviceCount} {run.scenario.deviceMix} ·
                        {' '}{run.scenario.totalDurationSeconds}s
                    </div>
                </Link>
            </td>
            <td className="px-4 py-2 text-xs">{new Date(run.startedAt).toLocaleString()}</td>
            <td className="px-4 py-2 text-right tabular-nums">{run.summary?.devicesSpawned ?? '—'}</td>
            <td className="px-4 py-2 text-right tabular-nums">
                {run.summary ? `${run.summary.sessionsStarted} / ${run.summary.sessionsStopped}` : '—'}
            </td>
            <td
                className={cn(
                    'px-4 py-2 text-right tabular-nums',
                    (run.summary?.errors ?? 0) > 0 && 'text-destructive',
                )}
            >
                {run.summary?.errors ?? '—'}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">
                {run.summary ? `${run.summary.elapsedSeconds}s` : '—'}
            </td>
        </tr>
    );
}

function StatusBadge({ status }: { status: BenchmarkRun['status'] }) {
    if (status === 'running') {
        return (
            <Badge variant="online" className="gap-1.5">
                <Activity className="h-3 w-3" /> Running
            </Badge>
        );
    }
    if (status === 'completed') {
        return (
            <Badge variant="secondary" className="gap-1.5">
                <CheckCircle2 className="h-3 w-3" /> Completed
            </Badge>
        );
    }
    if (status === 'stopped') {
        return (
            <Badge variant="outline" className="gap-1.5">
                <StopCircle className="h-3 w-3" /> Stopped
            </Badge>
        );
    }
    return (
        <Badge variant="destructive" className="gap-1.5">
            {status === 'failed' ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {status === 'failed' ? 'Failed' : status}
        </Badge>
    );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
    return (
        <div className="rounded-md border bg-secondary/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn('text-xl font-semibold tabular-nums', accent)}>{value}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            {children}
        </div>
    );
}
