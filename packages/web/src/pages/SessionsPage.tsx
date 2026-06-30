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
import { api } from '@/lib/api';
import type { Session } from '@ocpp-sim/core';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

type StatusFilter = 'all' | Session['status'];

const PAGE_SIZES = [25, 50, 100];

export function SessionsPage() {
    const [status, setStatus] = useState<StatusFilter>('all');
    const [deviceId, setDeviceId] = useState<string>('all');
    const [idTag, setIdTag] = useState('');
    const [pageSize, setPageSize] = useState(25);
    const [page, setPage] = useState(0);

    const devicesQuery = useQuery({
        queryKey: ['devices'],
        queryFn: api.listDevices,
    });

    const offset = page * pageSize;
    const filter = {
        status: status === 'all' ? undefined : status,
        deviceId: deviceId === 'all' ? undefined : deviceId,
        idTag: idTag.trim() || undefined,
        limit: pageSize,
        offset,
    };

    const { data, isLoading } = useQuery({
        queryKey: ['sessions', filter],
        queryFn: () => api.listSessions(filter),
        placeholderData: (prev) => prev, // keeps the table populated while next page loads
    });

    const sessions = data?.sessions ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const resetToFirstPage = () => setPage(0);

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold">Sessions</h1>
                <p className="text-sm text-muted-foreground">
                    All charging sessions, newest first.
                </p>
            </div>

            <Card>
                <CardContent className="p-3 flex flex-wrap items-end gap-3">
                    <FilterField label="Status">
                        <Select
                            value={status}
                            onValueChange={(v) => {
                                setStatus(v as StatusFilter);
                                resetToFirstPage();
                            }}
                        >
                            <SelectTrigger className="h-8 w-32 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="aborted">Aborted</SelectItem>
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Device">
                        <Select
                            value={deviceId}
                            onValueChange={(v) => {
                                setDeviceId(v);
                                resetToFirstPage();
                            }}
                        >
                            <SelectTrigger className="h-8 w-44 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All devices</SelectItem>
                                {(devicesQuery.data ?? []).map((d) => (
                                    <SelectItem key={d.id} value={d.id}>
                                        {d.displayName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="ID tag">
                        <Input
                            value={idTag}
                            onChange={(e) => {
                                setIdTag(e.target.value);
                                resetToFirstPage();
                            }}
                            placeholder="contains…"
                            className="h-8 w-40 text-xs"
                        />
                    </FilterField>

                    <FilterField label="Page size">
                        <Select
                            value={String(pageSize)}
                            onValueChange={(v) => {
                                setPageSize(Number(v));
                                resetToFirstPage();
                            }}
                        >
                            <SelectTrigger className="h-8 w-20 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAGE_SIZES.map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <span className="ml-auto text-xs text-muted-foreground">
                        {total} session{total === 1 ? '' : 's'}
                    </span>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        {isLoading ? 'Loading…' : `Page ${page + 1} of ${totalPages}`}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="px-4 py-2 text-left">Status</th>
                                <th className="px-4 py-2 text-left">Device</th>
                                <th className="px-4 py-2 text-left">Conn</th>
                                <th className="px-4 py-2 text-left">ID tag</th>
                                <th className="px-4 py-2 text-left">Started</th>
                                <th className="px-4 py-2 text-left">Ended</th>
                                <th className="px-4 py-2 text-right">Energy</th>
                                <th className="px-4 py-2 text-right">Peak</th>
                                <th className="px-4 py-2 text-left">Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessions.map((s) => (
                                <tr key={s.id} className="border-b last:border-b-0">
                                    <td className="px-4 py-2">
                                        <Badge
                                            variant={
                                                s.status === 'active'
                                                    ? 'online'
                                                    : s.status === 'completed'
                                                      ? 'secondary'
                                                      : 'destructive'
                                            }
                                        >
                                            {s.status}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">{s.deviceId}</td>
                                    <td className="px-4 py-2">{s.connectorId}</td>
                                    <td className="px-4 py-2 font-mono text-xs">{s.idTag}</td>
                                    <td className="px-4 py-2 text-xs">
                                        {new Date(s.startedAt).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-xs">
                                        {s.endedAt ? new Date(s.endedAt).toLocaleString() : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                        {(s.energyWh / 1000).toFixed(3)} kWh
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                        {s.peakPowerKw.toFixed(1)} kW
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">
                                        {s.endReason ?? '—'}
                                    </td>
                                </tr>
                            ))}
                            {sessions.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={9}
                                        className="px-4 py-8 text-center text-muted-foreground"
                                    >
                                        {isLoading
                                            ? 'Loading…'
                                            : 'No sessions match the current filters.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                    >
                        <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                        {offset + 1}–{Math.min(offset + sessions.length, total)} of {total}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= totalPages - 1}
                    >
                        Next <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {label}
            </Label>
            <div>{children}</div>
        </div>
    );
}
