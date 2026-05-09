import {
    ArrowDownToLine,
    ArrowUpFromLine,
    ChevronDown,
    ChevronRight,
    Eraser,
    Pause,
    Play,
    Search,
    Terminal,
    Waves,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { type TraceEntry, useLiveStore } from '@/lib/live-store';

interface Props {
    deviceId: string;
}

/**
 * Live OCPP trace for a single device. Reads the per-device ring
 * buffer from the live store (server fans frames over the WS pubsub
 * → store appends, capped at 500). Supports text filter, follow/pause,
 * clear, and per-row JSON expand.
 */
/** Window during which a `frames-coalesced` event still counts as
 *  "currently throttling". Tied to the server's 100ms flush cadence:
 *  if no drops in this many ms, the indicator goes away. */
const COALESCE_INDICATOR_MS = 3000;

export function TraceViewer({ deviceId }: Props) {
    const traces = useLiveStore((s) => s.traces.get(deviceId)) ?? EMPTY;
    const clear = useLiveStore((s) => s.clearTraces);
    const coalesce = useLiveStore((s) => s.coalesce);

    const [filter, setFilter] = useState('');
    const [follow, setFollow] = useState(true);
    const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
    // Re-render every ~500ms only while a recent coalesce sample is
    // still inside the indicator window. This is what lets the badge
    // disappear after the load drops; without it we'd be stuck on
    // the last value forever.
    const [, setTick] = useState(0);
    useEffect(() => {
        if (coalesce.lastSampleAt === 0) return;
        const id = setInterval(() => setTick((n) => n + 1), 500);
        return () => clearInterval(id);
    }, [coalesce.lastSampleAt]);

    const isThrottling =
        coalesce.lastSampleAt > 0 && Date.now() - coalesce.lastSampleAt < COALESCE_INDICATOR_MS;

    const filtered = useMemo(() => {
        if (!filter.trim()) return traces;
        const q = filter.toLowerCase();
        return traces.filter(
            (t) => t.action.toLowerCase().includes(q) || t.direction.includes(q) || t.id.includes(q),
        );
    }, [traces, filter]);

    // Auto-scroll on new entries when follow is on.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!follow) return;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [filtered, follow]);

    const toggle = (seq: number) => {
        setOpenIds((s) => {
            const next = new Set(s);
            if (next.has(seq)) next.delete(seq);
            else next.add(seq);
            return next;
        });
    };

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 gap-2 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                    <Terminal className="h-4 w-4" /> OCPP trace
                    <span className="text-xs font-normal text-muted-foreground">
                        {filtered.length}
                        {filter && filtered.length !== traces.length && ` of ${traces.length}`}
                        {traces.length === 500 && ' (last 500)'}
                    </span>
                    {isThrottling && (
                        <Badge
                            variant="outline"
                            className="gap-1 bg-amber-500/15 text-amber-600 border-amber-500/30"
                            title={`Server coalesced ${coalesce.totalDropped} repetitive frames since this tab opened`}
                        >
                            <Waves className="h-3 w-3" />
                            throttled +{coalesce.lastWindowDropped}
                        </Badge>
                    )}
                </CardTitle>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Filter…"
                            className="h-8 pl-7 w-40 text-xs"
                        />
                    </div>
                    <Button
                        size="sm"
                        variant={follow ? 'default' : 'outline'}
                        onClick={() => setFollow((v) => !v)}
                        aria-pressed={follow}
                        title={follow ? 'Auto-scroll: on' : 'Auto-scroll: paused'}
                    >
                        {follow ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {follow ? 'Pause' : 'Follow'}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => clear(deviceId)}
                        disabled={traces.length === 0}
                        title="Clear trace buffer"
                    >
                        <Eraser className="h-3.5 w-3.5" />
                        Clear
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div
                    ref={scrollRef}
                    className="font-mono text-xs max-h-[420px] overflow-y-auto border-t bg-background/40"
                >
                    {filtered.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-sm font-sans">
                            {traces.length === 0
                                ? 'No frames yet. Trigger a session, swipe, or fault — frames will appear here in real time.'
                                : 'No frames match the filter.'}
                        </div>
                    ) : (
                        <ul className="divide-y divide-border/50">
                            {filtered.map((t) => (
                                <Row key={t.seq} entry={t} open={openIds.has(t.seq)} onToggle={() => toggle(t.seq)} />
                            ))}
                        </ul>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

const EMPTY: TraceEntry[] = [];

function Row({ entry, open, onToggle }: { entry: TraceEntry; open: boolean; onToggle: () => void }) {
    const time = new Date(entry.at);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    const ss = String(time.getSeconds()).padStart(2, '0');
    const ms = String(time.getMilliseconds()).padStart(3, '0');
    const ts = `${hh}:${mm}:${ss}.${ms}`;
    const isIn = entry.direction === 'in';

    return (
        <li>
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary/40"
            >
                <span className="text-muted-foreground tabular-nums">{ts}</span>
                {isIn ? (
                    <ArrowDownToLine className="h-3.5 w-3.5 text-brand-blue shrink-0" />
                ) : (
                    <ArrowUpFromLine className="h-3.5 w-3.5 text-brand-orange shrink-0" />
                )}
                <Badge
                    variant="outline"
                    className={cn(
                        'h-5 px-1.5 text-[10px] uppercase tracking-wide border-transparent',
                        isIn
                            ? 'bg-brand-blue/15 text-brand-blue'
                            : 'bg-brand-orange/15 text-brand-orange',
                    )}
                >
                    {entry.direction}
                </Badge>
                <span className="font-medium text-foreground truncate">{entry.action}</span>
                <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                    <span className="hidden sm:inline truncate max-w-[8rem]">{entry.id.slice(0, 8)}</span>
                    {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </span>
            </button>
            {open && (
                <pre className="px-3 py-2 bg-secondary/30 text-xs whitespace-pre-wrap break-words text-foreground/90 border-t border-border/50">
                    {JSON.stringify(entry.payload, null, 2)}
                </pre>
            )}
        </li>
    );
}
