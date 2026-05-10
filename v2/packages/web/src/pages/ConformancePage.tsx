import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ClipboardCheck, Play, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

interface CaseRow {
    id: string;
    title: string;
    profile: string;
    status?: 'passed' | 'failed';
    error?: string | null;
    durationMs?: number;
}

/**
 * /conformance — runs the bundled OCPP 1.6 case suite against the
 * simulator and renders pass/fail per case. The page asks the server
 * to enumerate the cases on first load (so the table renders even
 * before a run), then POSTs /api/conformance/run on demand.
 *
 * Cases stay grouped by profile because the OCPP spec is itself
 * organised that way and operators reason about it the same.
 */
export function ConformancePage() {
    const { data: cases, isLoading } = useQuery({
        queryKey: ['conformance-cases'],
        queryFn: api.listConformanceCases,
    });
    const [results, setResults] = useState<Map<string, { status: 'passed' | 'failed'; error: string | null; durationMs: number }>>(
        () => new Map(),
    );
    const [summary, setSummary] = useState<{ passed: number; failed: number; durationMs: number } | null>(null);
    const [openErrorId, setOpenErrorId] = useState<string | null>(null);

    const run = useMutation({
        mutationFn: api.runConformance,
        onSuccess: (res) => {
            const m = new Map<string, { status: 'passed' | 'failed'; error: string | null; durationMs: number }>();
            for (const c of res.cases) {
                m.set(c.id, { status: c.status, error: c.error, durationMs: c.durationMs });
            }
            setResults(m);
            setSummary({ passed: res.passed, failed: res.failed, durationMs: res.durationMs });
        },
    });

    // Build display rows by merging the case index (which is what we
    // know about *before* the first run) with any results we have.
    const rows: CaseRow[] = useMemo(() => {
        const list = cases?.cases ?? [];
        return list.map((c) => {
            const r = results.get(c.id);
            return r
                ? { ...c, status: r.status, error: r.error, durationMs: r.durationMs }
                : { ...c };
        });
    }, [cases, results]);

    // Group by profile for rendering. Insertion order of the case
    // array picks the section order — Core first because that's the
    // baseline a CSMS team validates against.
    const grouped = useMemo(() => {
        const out = new Map<string, CaseRow[]>();
        for (const r of rows) {
            const list = out.get(r.profile) ?? [];
            list.push(r);
            out.set(r.profile, list);
        }
        return out;
    }, [rows]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <ClipboardCheck className="h-6 w-6 text-brand-orange" />
                        OCPP conformance
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Bundled case suite. Each case runs against a fresh MockCsms + Simulator pair and asserts
                        spec-correct behaviour.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {summary && <SummaryPill summary={summary} />}
                    <Button onClick={() => run.mutate()} disabled={run.isPending}>
                        <Play className="h-4 w-4" />
                        {run.isPending ? 'Running…' : results.size > 0 ? 'Run again' : 'Run suite'}
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        No conformance cases found.
                    </CardContent>
                </Card>
            ) : (
                <>
                    {[...grouped.entries()].map(([profile, list]) => (
                        <Card key={profile}>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    {profile} profile
                                    <span className="text-xs font-normal text-muted-foreground">
                                        {list.length} case{list.length === 1 ? '' : 's'}
                                    </span>
                                    <ProfileSummary list={list} />
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <ul className="divide-y divide-border/50 border-t">
                                    {list.map((r) => (
                                        <CaseRowView
                                            key={r.id}
                                            row={r}
                                            errorOpen={openErrorId === r.id}
                                            onToggleError={() =>
                                                setOpenErrorId((id) => (id === r.id ? null : r.id))
                                            }
                                            running={run.isPending}
                                        />
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    ))}
                </>
            )}
        </div>
    );
}

function SummaryPill({ summary }: { summary: { passed: number; failed: number; durationMs: number } }) {
    const tone =
        summary.failed === 0
            ? 'bg-brand-green/15 text-brand-green border-brand-green/30'
            : 'bg-destructive/15 text-destructive border-destructive/30';
    return (
        <Badge variant="outline" className={`text-xs gap-1.5 ${tone}`}>
            {summary.failed === 0 ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {summary.passed}/{summary.passed + summary.failed} passed
            <span className="text-muted-foreground/80 ml-1">·</span>
            <span className="tabular-nums">{(summary.durationMs / 1000).toFixed(1)}s</span>
        </Badge>
    );
}

function ProfileSummary({ list }: { list: CaseRow[] }) {
    const ran = list.filter((r) => r.status !== undefined);
    if (ran.length === 0) return null;
    const passed = ran.filter((r) => r.status === 'passed').length;
    const failed = ran.length - passed;
    const tone =
        failed === 0
            ? 'bg-brand-green/15 text-brand-green border-brand-green/30'
            : 'bg-destructive/15 text-destructive border-destructive/30';
    return (
        <Badge variant="outline" className={`text-[10px] gap-1 ${tone}`}>
            {passed}/{ran.length}
        </Badge>
    );
}

function CaseRowView({
    row,
    errorOpen,
    onToggleError,
    running,
}: {
    row: CaseRow;
    errorOpen: boolean;
    onToggleError: () => void;
    running: boolean;
}) {
    return (
        <li>
            <div className="px-3 py-2 flex items-start gap-3">
                <StatusIcon status={row.status} running={running} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground truncate">{row.id}</span>
                        {row.durationMs !== undefined && (
                            <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                                {row.durationMs}ms
                            </span>
                        )}
                    </div>
                    <p className="text-sm">{row.title}</p>
                </div>
                {row.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={onToggleError}>
                        {errorOpen ? 'Hide' : 'Show'} error
                    </Button>
                )}
            </div>
            {row.status === 'failed' && errorOpen && row.error && (
                <pre className="mx-3 mb-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-md text-xs whitespace-pre-wrap break-words text-destructive font-mono">
                    {row.error}
                </pre>
            )}
        </li>
    );
}

function StatusIcon({ status, running }: { status?: 'passed' | 'failed'; running: boolean }) {
    if (status === 'passed') {
        return (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-brand-green">
                <Check className="h-3 w-3" />
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive">
                <X className="h-3 w-3" />
            </span>
        );
    }
    if (running) {
        return (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600">
                <span className="block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            </span>
        );
    }
    return (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground">
            <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        </span>
    );
}
