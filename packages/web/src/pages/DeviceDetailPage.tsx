import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChargingProfiles } from '@/components/ChargingProfiles';
import { EditDeviceDialog } from '@/components/EditDeviceDialog';
import { LiveDot } from '@/components/LiveDot';
import { ManualControls } from '@/components/ManualControls';
import { OcppConfigCard } from '@/components/OcppConfigCard';
import { TraceViewer } from '@/components/TraceViewer';
import { api } from '@/lib/api';
import { liveKey, useLiveStore } from '@/lib/live-store';

export function DeviceDetailPage() {
    const { id = '' } = useParams<{ id: string }>();
    const qc = useQueryClient();
    const [editing, setEditing] = useState(false);

    const { data: device, isLoading } = useQuery({
        queryKey: ['devices', id],
        queryFn: () => api.getDevice(id),
        enabled: !!id,
    });

    const onlineMap = useLiveStore((s) => s.online);
    const connectorStatusMap = useLiveStore((s) => s.connectorStatus);
    const tickMap = useLiveStore((s) => s.tick);

    const startSession = useMutation({
        mutationFn: (connectorId: number) => api.startSession(id, connectorId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['devices', id] });
            qc.invalidateQueries({ queryKey: ['sessions'] });
        },
    });
    const stopSession = useMutation({
        mutationFn: (connectorId: number) => api.stopSession(id, connectorId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['devices', id] });
            qc.invalidateQueries({ queryKey: ['sessions'] });
        },
    });

    if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
    if (!device) return <p className="text-muted-foreground">Device not found.</p>;

    const online = onlineMap.get(device.id) ?? device.online;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Link to="/devices">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <Badge variant={device.type === 'DC' ? 'dc' : 'ac'}>{device.type}</Badge>
                        <h1 className="text-2xl font-semibold">{device.displayName}</h1>
                        <Badge variant={online ? 'online' : 'offline'} className="gap-1.5">
                            <LiveDot pulse={online} tone={online ? 'green' : 'gray'} />
                            {online ? 'Online' : 'Offline'}
                        </Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{device.id}</p>
                </div>
                <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                </Button>
            </div>

            <EditDeviceDialog device={device} open={editing} onOpenChange={setEditing} />


            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Device</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <Field label="Model" value={device.model} />
                    <Field label="Vendor" value={device.vendor} />
                    <Field label="Firmware" value={device.firmwareVersion} />
                    <Field label="Max power" value={`${device.maxPowerKw} kW`} />
                    <Field label="Phase mode" value={device.phaseMode} />
                    <Field label="OCPP URL" value={device.ocppUrl} mono />
                </CardContent>
            </Card>

            <div>
                <h2 className="text-lg font-semibold mb-3">Connectors</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {device.connectors.map((c) => {
                        const status = connectorStatusMap.get(liveKey(device.id, c.id)) ?? c.status;
                        const tick = tickMap.get(liveKey(device.id, c.id));
                        const charging = status === 'Charging';
                        return (
                            <Card key={c.id}>
                                <CardHeader className="flex-row items-center justify-between space-y-0">
                                    <CardTitle className="text-base">Connector {c.id}</CardTitle>
                                    <Badge
                                        variant={charging ? 'online' : status === 'Faulted' ? 'destructive' : 'outline'}
                                        className="gap-1.5"
                                    >
                                        {charging && <LiveDot pulse tone="green" />}
                                        {status}
                                    </Badge>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-3 gap-2 text-sm">
                                        <Metric label="Power" value={tick ? `${tick.powerKw.toFixed(1)} kW` : '— kW'} />
                                        <Metric label="Energy" value={tick ? `${tick.energyKwh.toFixed(3)} kWh` : '— kWh'} />
                                        <Metric label="SoC" value={tick?.socPct !== undefined ? `${tick.socPct.toFixed(0)} %` : '—'} />
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="default"
                                            disabled={!online || charging || startSession.isPending}
                                            onClick={() => startSession.mutate(c.id)}
                                            className="flex-1"
                                        >
                                            <Play className="h-4 w-4" /> Start
                                        </Button>
                                        <Button
                                            variant="outline"
                                            disabled={!charging || stopSession.isPending}
                                            onClick={() => stopSession.mutate(c.id)}
                                            className="flex-1"
                                        >
                                            <Square className="h-4 w-4" /> Stop
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>

            <ManualControls device={device} />

            <OcppConfigCard deviceId={device.id} />

            <ChargingProfiles deviceId={device.id} />

            <TraceViewer deviceId={device.id} />
        </div>
    );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={mono ? 'font-mono text-xs break-all' : ''}>{value}</div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border bg-secondary/40 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-base font-mono tabular-nums">{value}</div>
        </div>
    );
}
