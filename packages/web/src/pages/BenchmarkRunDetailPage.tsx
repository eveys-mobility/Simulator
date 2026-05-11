import { useQuery } from '@tanstack/react-query';
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    BarChart3,
    CheckCircle2,
    ExternalLink,
    StopCircle,
    XCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useLiveStore } from '@/lib/live-store';
import type { BenchmarkRun } from '@ocpp-sim/core';

/**
 * Grafana base URL. Hardcoded to localhost:3000 because the dashboard
 * lives in the docker-compose stack we ship; the user runs it on the
 * same host as the simulator. If they front Grafana with a different
 * URL, this is a one-line config change.
 */
const GRAFANA_BASE = 'http://localhost:3000';
const DASHBOARD_UID = 'ocpp-overview';

interface PanelSpec {
    panelId: number;
    title: string;
    description: string;
    /** Tailwind-friendly grid span, default full width on mobile */
    colSpan?: 1 | 2;
}

/**
 * Panel ids match the ones declared in
 * `observability/grafana/dashboards/ocpp-overview.json`.
 *
 * 1 Active devices  2 Online   3 Active sessions   4 WS reconnects (5m)
 * 5 CALL rate       6 p99 CALL latency
 * 7 Errors/sec      8 Frame throughput in/out
 */
const PANELS: PanelSpec[] = [
    { panelId: 5, title: 'CALL rate by action', description: 'OCPP CALLs per second, broken down by action.', colSpan: 2 },
    { panelId: 6, title: 'p99 CALL latency by action', description: 'Round-trip latency p99 for each OCPP action over the run window.', colSpan: 2 },
    { panelId: 7, title: 'Errors / sec', description: 'CALLERROR + timeout events grouped by action and error code.', colSpan: 1 },
    { panelId: 8, title: 'Frame throughput', description: 'Total frames in/out per second.', colSpan: 1 },
    { panelId: 3, title: 'Active sessions', description: 'Currently-charging connectors during the run window.', colSpan: 1 },
    { panelId: 2, title: 'Online devices', description: 'Devices online during the run window.', colSpan: 1 },
];

/**
 * Build a Grafana solo-panel URL scoped to a time window. Pads the
 * window by 30 s on each side so the rate() PromQL has a full lookback
 * sample at run start, and a clean settle on completion.
 */
function panelUrl(panelId: number, from: number, to: number, isDark: boolean): string {
    const padMs = 30_000;
    const params = new URLSearchParams({
        panelId: String(panelId),
        from: String(from - padMs),
        to: String(to + padMs),
        theme: isDark ? 'dark' : 'light',
        kiosk: 'tv-lite',
        refresh: '10s',
    });
    return `${GRAFANA_BASE}/d-solo/${DASHBOARD_UID}/ocpp-simulator-overview?${params.toString()}`;
}

export function BenchmarkRunDetailPage() {
    const { id = '' } = useParams<{ id: string }>();
    const runId = Number(id);

    const { data: run, isLoading, error } = useQuery({
        queryKey: ['benchmark-runs', runId],
        queryFn: () => api.getBenchmarkRun(runId),
        enabled: Number.isFinite(runId),
        // Refetch while the run is going so the summary lands in the UI
        // the moment the engine finishes, without waiting for a WS
        // benchmark-done event to arrive.
        refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false),
    });

    // Live progress stream for the in-flight case.
    const progress = useLiveStore((s) => (Number.isFinite(runId) ? s.benchmarkProgress.get(runId) : undefined));

    if (!Number.isFinite(runId)) return <p className="text-sm text-destructive">Invalid run id.</p>;
    if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (error || !run) return <p className="text-sm text-destructive">Run not found.</p>;

    const startedMs = new Date(run.startedAt).getTime();
    const endedMs = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Link to="/benchmark">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={run.status} />
                        <h1 className="text-2xl font-semibold truncate">{run.scenario.name}</h1>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Run #{run.id} · started {new Date(run.startedAt).toLocaleString()}
                        {run.endedAt && ` · ended ${new Date(run.endedAt).toLocaleString()}`}
                    </p>
                </div>
                <a
                    href={`${GRAFANA_BASE}/d/${DASHBOARD_UID}?from=${startedMs - 30_000}&to=${endedMs + 30_000}`}
                    target="_blank"
                    rel="noreferrer"
                >
                    <Button variant="outline">
                        <ExternalLink className="h-3.5 w-3.5" /> Open in Grafana
                    </Button>
                </a>
            </div>

            <ScenarioCard run={run} progress={progress} />

            <div>
                <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Analytics</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                    Live Grafana panels scoped to this run's window. Bring the stack up with
                    {' '}<code className="font-mono text-xs px-1 py-0.5 rounded bg-secondary/40">cd v2 && docker compose up -d</code>
                    {' '}if these don't load.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {PANELS.map((p) => (
                        <PanelCard
                            key={p.panelId}
                            spec={p}
                            url={panelUrl(p.panelId, startedMs, endedMs, isDark)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ScenarioCard({
    run,
    progress,
}: {
    run: BenchmarkRun;
    progress?: { devicesOnline: number; sessionsActive: number; sessionsStarted: number; sessionsStopped: number; errors: number };
}) {
    const summary = run.summary;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Scenario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <Field label="Devices" value={`${run.scenario.deviceCount} ${run.scenario.deviceMix}`} />
                    <Field label="Ramp-up" value={`${run.scenario.rampUpSeconds}s`} />
                    <Field label="Sessions / hr / dev" value={String(run.scenario.sessionsPerHourPerDevice)} />
                    <Field label="Session duration" value={`${run.scenario.sessionDurationSeconds}s`} />
                    <Field label="Meter cadence" value={`${run.scenario.meterValueIntervalSeconds}s`} />
                    <Field label="Total duration" value={`${run.scenario.totalDurationSeconds}s`} />
                    <Field label="Auto-cleanup" value={run.scenario.autoCleanup ? 'Yes' : 'No'} />
                    <Field label="OCPP URL" value={run.scenario.ocppUrl ?? '(default)'} mono />
                </div>

                {/*
                  Two summary modes:
                    - run finished → use run.summary (authoritative)
                    - run still running → use the live progress event
                */}
                {summary ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t pt-4">
                        <Stat label="Devices spawned" value={summary.devicesSpawned} />
                        <Stat label="Devices cleaned" value={summary.devicesCleaned} />
                        <Stat label="Sessions started" value={summary.sessionsStarted} />
                        <Stat label="Sessions stopped" value={summary.sessionsStopped} />
                        <Stat
                            label="Errors"
                            value={summary.errors}
                            accent={summary.errors > 0 ? 'text-destructive' : undefined}
                        />
                    </div>
                ) : progress ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t pt-4">
                        <Stat label="Devices online" value={progress.devicesOnline} />
                        <Stat label="Active sessions" value={progress.sessionsActive} accent="text-brand-orange" />
                        <Stat label="Sessions started" value={progress.sessionsStarted} />
                        <Stat label="Sessions stopped" value={progress.sessionsStopped} />
                        <Stat
                            label="Errors"
                            value={progress.errors}
                            accent={progress.errors > 0 ? 'text-destructive' : undefined}
                        />
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}

function PanelCard({ spec, url }: { spec: PanelSpec; url: string }) {
    return (
        <Card className={cn(spec.colSpan === 2 && 'lg:col-span-2')}>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm">{spec.title}</CardTitle>
                <p className="text-xs text-muted-foreground">{spec.description}</p>
            </CardHeader>
            <CardContent className="p-0">
                <iframe
                    src={url}
                    title={spec.title}
                    width="100%"
                    height={280}
                    frameBorder="0"
                    className="block w-full bg-background"
                />
            </CardContent>
        </Card>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn('text-foreground', mono && 'font-mono text-xs break-all')}>{value}</div>
        </div>
    );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
    return (
        <div className="rounded-md border bg-secondary/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn('text-xl font-semibold tabular-nums', accent)}>{value}</div>
        </div>
    );
}
