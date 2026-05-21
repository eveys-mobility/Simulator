import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Database, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useLiveStore } from '@/lib/live-store';

/**
 * Inspect (and optionally clear) the CP's offline message buffer
 * for a single device. The CP buffers transaction-related frames
 * (StartTransaction / MeterValues / StopTransaction) while the WS
 * to the CSMS is down, then drains them in FIFO order on reconnect
 * per OCPP 1.6 §4.7. This card surfaces exactly what's waiting.
 *
 * Refreshes on a slow timer plus any queueOverflow event we see on
 * the live WS (which already invalidates ['fleet-summary'] and the
 * device row; we piggy-back on those).
 */
export function BufferMemoryCard({ deviceId }: { deviceId: string }) {
    const qc = useQueryClient();
    const queue = useQuery({
        queryKey: ['device-queue', deviceId],
        queryFn: () => api.listDeviceQueue(deviceId),
        // Slow safety-net refresh; the live WS is the primary signal.
        refetchInterval: 10_000,
    });
    // Surface a recent overflow event so the card matches the page header.
    const queueOverflowMap = useLiveStore((s) => s.queueOverflow);
    const overflow = queueOverflowMap.get(deviceId);
    const overflowRecent = overflow ? Date.now() - overflow.lastAt < 30_000 : false;

    const clearAll = useMutation({
        mutationFn: () => api.clearDeviceQueue(deviceId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['device-queue', deviceId] });
            qc.invalidateQueries({ queryKey: ['devices', deviceId] });
            qc.invalidateQueries({ queryKey: ['fleet-summary'] });
        },
    });
    const clearMeters = useMutation({
        mutationFn: () => api.clearDeviceQueue(deviceId, { action: 'MeterValues' }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['device-queue', deviceId] });
            qc.invalidateQueries({ queryKey: ['devices', deviceId] });
            qc.invalidateQueries({ queryKey: ['fleet-summary'] });
        },
    });

    const [confirmingClearAll, setConfirmingClearAll] = useState(false);

    const rows = queue.data?.rows ?? [];
    const total = queue.data?.total ?? 0;
    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const r of rows) c[r.action] = (c[r.action] ?? 0) + 1;
        return c;
    }, [rows]);

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Buffer memory
                    {total > 0 && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                            {total} pending
                        </Badge>
                    )}
                </CardTitle>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => clearMeters.mutate()}
                        disabled={clearMeters.isPending || (counts['MeterValues'] ?? 0) === 0}
                        title="Discard buffered MeterValues only — preserves Start/Stop so the transaction record stays intact"
                    >
                        <Trash2 className="h-3.5 w-3.5" /> Clear MeterValues
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmingClearAll(true)}
                        disabled={clearAll.isPending || total === 0}
                        title="Discard every buffered row — Start/Stop included, losing the transaction record"
                    >
                        <Trash2 className="h-3.5 w-3.5" /> Clear all
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {total === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Buffer empty. The CP will queue StartTransaction / MeterValues /
                        StopTransaction here when it's offline; rows drain in order on the next
                        reconnect.
                    </p>
                ) : (
                    <>
                        <div className="flex flex-wrap gap-2 text-xs">
                            {Object.entries(counts).map(([action, n]) => (
                                <Badge key={action} variant="outline" className="gap-1">
                                    {action}
                                    <span className="font-mono text-muted-foreground">{n}</span>
                                </Badge>
                            ))}
                        </div>
                        {overflowRecent && overflow && (
                            <p className="text-xs text-destructive">
                                Recent overflow: {overflow.lastDropped} oldest MeterValues row
                                {overflow.lastDropped === 1 ? '' : 's'} dropped (cap {overflow.kept}).
                            </p>
                        )}
                        <ul className="divide-y border rounded-md">
                            {rows.map((r) => (
                                <BufferRow key={r.id} row={r} />
                            ))}
                        </ul>
                    </>
                )}
            </CardContent>
            <ConfirmDialog
                open={confirmingClearAll}
                onOpenChange={(o) => {
                    if (!o) setConfirmingClearAll(false);
                }}
                title="Clear the device's offline buffer"
                description={
                    <>
                        This drops every buffered transaction frame for this device, including
                        StartTransaction and StopTransaction. The CSMS will never see what was in
                        flight — the in-progress transaction record is lost. Type the word below
                        to confirm.
                    </>
                }
                confirmText="Clear buffer"
                destructive
                typedConfirmation="CLEAR"
                pending={clearAll.isPending}
                onConfirm={() => {
                    clearAll.mutate();
                    setConfirmingClearAll(false);
                }}
            />
        </Card>
    );
}

function BufferRow({
    row,
}: {
    row: {
        id: number;
        action: string;
        payload: unknown;
        queuedAt: string;
        localTxId: number | null;
    };
}) {
    const [open, setOpen] = useState(false);
    const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(row.queuedAt)) / 1000));
    return (
        <li>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary/40"
            >
                {open ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="font-medium text-sm truncate">{row.action}</span>
                {row.localTxId !== null && (
                    <Badge variant="outline" className="text-[10px]" title="Started while offline; the real txId is assigned on drain">
                        local tx {row.localTxId}
                    </Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {formatAge(ageSec)} ago
                </span>
            </button>
            {open && (
                <pre className="px-3 py-2 bg-secondary/30 text-xs whitespace-pre-wrap break-words text-foreground/90 border-t">
                    {JSON.stringify(row.payload, null, 2)}
                </pre>
            )}
        </li>
    );
}

function formatAge(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}
