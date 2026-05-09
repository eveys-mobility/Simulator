import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LayoutGrid, List, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LiveDot } from '@/components/LiveDot';
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
import { api, type DeviceWithRuntime } from '@/lib/api';
import { cn } from '@/lib/cn';
import { liveKey, useLiveStore } from '@/lib/live-store';
import type { DeviceType } from '@ocpp-sim/core';

type Layout = 'grid' | 'table';
type StatusFilter = 'all' | 'online' | 'offline';
type TypeFilter = 'all' | 'AC' | 'DC';

const LAYOUT_KEY = 'ocpp-sim-devices-layout';

export function DevicesPage() {
    const { data: devices = [], isLoading } = useQuery({
        queryKey: ['devices'],
        queryFn: api.listDevices,
    });
    const qc = useQueryClient();
    const onlineMap = useLiveStore((s) => s.online);
    const connectorStatus = useLiveStore((s) => s.connectorStatus);

    const [layout, setLayout] = useState<Layout>(() => {
        if (typeof window === 'undefined') return 'grid';
        const saved = window.localStorage.getItem(LAYOUT_KEY);
        return saved === 'table' || saved === 'grid' ? saved : 'grid';
    });
    const setLayoutPersisted = (v: Layout) => {
        setLayout(v);
        try {
            window.localStorage.setItem(LAYOUT_KEY, v);
        } catch {}
    };

    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

    const create = useMutation({
        mutationFn: api.createDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
    });
    const remove = useMutation({
        mutationFn: api.deleteDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
    });

    const [showNew, setShowNew] = useState(false);

    /** Live-aware filter: an `online` change in WebSocket can flip a row's
     *  visibility immediately even if TanStack Query hasn't refetched yet. */
    const filtered = useMemo(() => {
        return devices.filter((d) => {
            if (typeFilter !== 'all' && d.type !== typeFilter) return false;
            const online = onlineMap.get(d.id) ?? d.online;
            if (statusFilter === 'online' && !online) return false;
            if (statusFilter === 'offline' && online) return false;
            return true;
        });
    }, [devices, statusFilter, typeFilter, onlineMap]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold">Devices</h1>
                    <p className="text-sm text-muted-foreground">Each device is one OCPP charge point.</p>
                </div>
                <Button onClick={() => setShowNew((v) => !v)}>
                    <Plus className="h-4 w-4" /> New device
                </Button>
            </div>

            {showNew && (
                <NewDeviceForm
                    onSubmit={(b) => create.mutate(b, { onSuccess: () => setShowNew(false) })}
                    pending={create.isPending}
                />
            )}

            {/* Filter + layout strip */}
            <Card>
                <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                        <FilterField label="Type">
                            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="AC">AC</SelectItem>
                                    <SelectItem value="DC">DC</SelectItem>
                                </SelectContent>
                            </Select>
                        </FilterField>
                        <FilterField label="Status">
                            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="online">Online</SelectItem>
                                    <SelectItem value="offline">Offline</SelectItem>
                                </SelectContent>
                            </Select>
                        </FilterField>
                        <span className="text-xs text-muted-foreground">
                            {filtered.length}
                            {filtered.length !== devices.length && ` of ${devices.length}`}
                        </span>
                    </div>
                    <div className="inline-flex rounded-md border bg-secondary/30 p-0.5">
                        <button
                            type="button"
                            onClick={() => setLayoutPersisted('grid')}
                            className={cn(
                                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                                layout === 'grid'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                            aria-pressed={layout === 'grid'}
                        >
                            <LayoutGrid className="h-3.5 w-3.5" /> Grid
                        </button>
                        <button
                            type="button"
                            onClick={() => setLayoutPersisted('table')}
                            className={cn(
                                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                                layout === 'table'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                            aria-pressed={layout === 'table'}
                        >
                            <List className="h-3.5 w-3.5" /> Table
                        </button>
                    </div>
                </CardContent>
            </Card>

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        {devices.length === 0
                            ? 'No devices yet. Create one above.'
                            : 'No devices match the current filters.'}
                    </CardContent>
                </Card>
            ) : layout === 'grid' ? (
                <GridView
                    devices={filtered}
                    onlineMap={onlineMap}
                    connectorStatus={connectorStatus}
                    onDelete={(d) => {
                        if (confirm(`Delete ${d.displayName}?`)) remove.mutate(d.id);
                    }}
                    deleting={remove.isPending}
                />
            ) : (
                <TableView
                    devices={filtered}
                    onlineMap={onlineMap}
                    connectorStatus={connectorStatus}
                    onDelete={(d) => {
                        if (confirm(`Delete ${d.displayName}?`)) remove.mutate(d.id);
                    }}
                    deleting={remove.isPending}
                />
            )}
        </div>
    );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
            {children}
        </div>
    );
}

interface ViewProps {
    devices: DeviceWithRuntime[];
    onlineMap: Map<string, boolean>;
    connectorStatus: Map<string, string>;
    onDelete: (d: DeviceWithRuntime) => void;
    deleting: boolean;
}

function GridView({ devices, onlineMap, connectorStatus, onDelete, deleting }: ViewProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((d) => {
                const online = onlineMap.get(d.id) ?? d.online;
                const charging = d.connectors.some(
                    (c) => (connectorStatus.get(liveKey(d.id, c.id)) ?? c.status) === 'Charging',
                );
                return (
                    <Link
                        key={d.id}
                        to={`/devices/${d.id}`}
                        className="group block rounded-lg ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <Card className="h-full transition-colors hover:border-brand-orange/40 hover:bg-card/80">
                            <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                                <div className="space-y-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={d.type === 'DC' ? 'dc' : 'ac'}>{d.type}</Badge>
                                        <CardTitle className="text-base truncate">{d.displayName}</CardTitle>
                                    </div>
                                    <p className="font-mono text-xs text-muted-foreground truncate">{d.id}</p>
                                </div>
                                <Badge variant={online ? 'online' : 'offline'} className="gap-1.5">
                                    <LiveDot pulse={online || charging} tone={online ? 'green' : 'gray'} />
                                    {online ? 'Online' : 'Offline'}
                                </Badge>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-0">
                                <ConnectorsRow device={d} connectorStatus={connectorStatus} />
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                    <Cell label="Model" value={d.model} />
                                    <Cell label="Max power" value={`${d.maxPowerKw} kW`} />
                                </div>
                                <div className="flex items-center justify-between border-t pt-3">
                                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors group-hover:text-brand-orange">
                                        Open device
                                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-destructive"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onDelete(d);
                                        }}
                                        disabled={deleting}
                                        aria-label={`Delete ${d.displayName}`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                );
            })}
        </div>
    );
}

function TableView({ devices, onlineMap, connectorStatus, onDelete, deleting }: ViewProps) {
    return (
        <Card>
            <CardContent className="p-0">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2 text-left">Type</th>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">ID</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 text-left">Connectors</th>
                            <th className="px-3 py-2 text-right">Max kW</th>
                            <th className="px-3 py-2 text-left">Phase</th>
                            <th className="px-3 py-2 text-right" />
                        </tr>
                    </thead>
                    <tbody>
                        {devices.map((d) => {
                            const online = onlineMap.get(d.id) ?? d.online;
                            const charging = d.connectors.some(
                                (c) => (connectorStatus.get(liveKey(d.id, c.id)) ?? c.status) === 'Charging',
                            );
                            return (
                                <tr key={d.id} className="border-b last:border-b-0 hover:bg-secondary/30">
                                    <td className="px-3 py-2">
                                        <Badge variant={d.type === 'DC' ? 'dc' : 'ac'}>{d.type}</Badge>
                                    </td>
                                    <td className="px-3 py-2">
                                        <Link to={`/devices/${d.id}`} className="hover:text-brand-orange">
                                            {d.displayName}
                                        </Link>
                                    </td>
                                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.id}</td>
                                    <td className="px-3 py-2">
                                        <Badge variant={online ? 'online' : 'offline'} className="gap-1.5">
                                            <LiveDot pulse={online || charging} tone={online ? 'green' : 'gray'} />
                                            {online ? 'Online' : 'Offline'}
                                        </Badge>
                                    </td>
                                    <td className="px-3 py-2">
                                        <ConnectorsRow device={d} connectorStatus={connectorStatus} dense />
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{d.maxPowerKw}</td>
                                    <td className="px-3 py-2 text-xs">{d.phaseMode}</td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="inline-flex items-center gap-1">
                                            <Link to={`/devices/${d.id}`}>
                                                <Button variant="ghost" size="sm">Open</Button>
                                            </Link>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-muted-foreground hover:text-destructive"
                                                onClick={() => onDelete(d)}
                                                disabled={deleting}
                                                aria-label={`Delete ${d.displayName}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}

function ConnectorsRow({
    device,
    connectorStatus,
    dense = false,
}: {
    device: DeviceWithRuntime;
    connectorStatus: Map<string, string>;
    dense?: boolean;
}) {
    return (
        <div className={cn('flex items-center gap-1.5', !dense && 'flex-wrap')}>
            {device.connectors.map((c) => {
                const status = connectorStatus.get(liveKey(device.id, c.id)) ?? c.status;
                const tone =
                    status === 'Charging'
                        ? 'green'
                        : status === 'Faulted'
                            ? 'red'
                            : status === 'Available'
                                ? 'gray'
                                : 'orange';
                return (
                    <span
                        key={c.id}
                        title={`Connector ${c.id}: ${status}`}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]',
                            'bg-secondary/40 text-foreground',
                        )}
                    >
                        <LiveDot pulse={status === 'Charging'} tone={tone} className="h-1.5 w-1.5" />
                        <span className="font-medium">{c.id}</span>
                        {!dense && <span className="text-muted-foreground">{status}</span>}
                    </span>
                );
            })}
        </div>
    );
}

function NewDeviceForm({
    onSubmit,
    pending,
}: {
    onSubmit: (body: { type: DeviceType; displayName?: string }) => void;
    pending: boolean;
}) {
    const [type, setType] = useState<DeviceType>('AC');
    const [name, setName] = useState('');
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">New device</CardTitle>
            </CardHeader>
            <CardContent>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit({ type, displayName: name.trim() || undefined });
                    }}
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                >
                    <div className="flex-1 space-y-1">
                        <label className="text-xs text-muted-foreground">Display name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lobby AC #1" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Type</label>
                        <div className="flex gap-1">
                            <Button type="button" variant={type === 'AC' ? 'default' : 'outline'} onClick={() => setType('AC')}>
                                AC
                            </Button>
                            <Button type="button" variant={type === 'DC' ? 'default' : 'outline'} onClick={() => setType('DC')}>
                                DC
                            </Button>
                        </div>
                    </div>
                    <Button type="submit" disabled={pending}>
                        {pending ? 'Creating…' : 'Create'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

function Cell({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-foreground truncate">{value}</div>
        </div>
    );
}
