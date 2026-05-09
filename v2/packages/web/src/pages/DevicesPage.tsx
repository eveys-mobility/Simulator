import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useLiveStore } from '@/lib/live-store';
import type { DeviceType } from '@ocpp-sim/core';

export function DevicesPage() {
    const { data: devices = [], isLoading } = useQuery({
        queryKey: ['devices'],
        queryFn: api.listDevices,
    });
    const qc = useQueryClient();
    const onlineMap = useLiveStore((s) => s.online);

    const create = useMutation({
        mutationFn: api.createDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
    });
    const remove = useMutation({
        mutationFn: api.deleteDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
    });

    const [showNew, setShowNew] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Devices</h1>
                    <p className="text-sm text-muted-foreground">Each device is one OCPP charge point.</p>
                </div>
                <Button onClick={() => setShowNew((v) => !v)}>
                    <Plus className="h-4 w-4" /> New device
                </Button>
            </div>

            {showNew && <NewDeviceForm onSubmit={(b) => create.mutate(b, { onSuccess: () => setShowNew(false) })} pending={create.isPending} />}

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : devices.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        No devices yet. Create one above.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {devices.map((d) => {
                        // Live online flag overrides the cached value when present.
                        const online = onlineMap.get(d.id) ?? d.online;
                        return (
                            <Card key={d.id}>
                                <CardHeader className="flex-row items-start justify-between space-y-0">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Badge variant={d.type === 'DC' ? 'dc' : 'ac'}>{d.type}</Badge>
                                            <CardTitle className="text-base">{d.displayName}</CardTitle>
                                        </div>
                                        <p className="font-mono text-xs text-muted-foreground">{d.id}</p>
                                    </div>
                                    <Badge variant={online ? 'online' : 'offline'}>{online ? 'Online' : 'Offline'}</Badge>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wide">Model</div>
                                            <div className="text-foreground">{d.model}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wide">Connectors</div>
                                            <div className="text-foreground">{d.connectors.length}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wide">Max power</div>
                                            <div className="text-foreground">{d.maxPowerKw} kW</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wide">Phase mode</div>
                                            <div className="text-foreground">{d.phaseMode}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <Link to={`/devices/${d.id}`} className="flex-1">
                                            <Button variant="secondary" className="w-full">Open</Button>
                                        </Link>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => {
                                                if (confirm(`Delete ${d.displayName}?`)) remove.mutate(d.id);
                                            }}
                                            disabled={remove.isPending}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function NewDeviceForm({ onSubmit, pending }: { onSubmit: (body: { type: DeviceType; displayName?: string }) => void; pending: boolean }) {
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
