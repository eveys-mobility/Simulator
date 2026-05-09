import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    AlertOctagon,
    AlertTriangle,
    CreditCard,
    Plug,
    PlugZap,
    RefreshCw,
    Wrench,
    Zap,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
import { api, type DeviceWithRuntime } from '@/lib/api';
import { liveKey, useLiveStore } from '@/lib/live-store';

const FAULT_CODES = [
    'OtherError',
    'ConnectorLockFailure',
    'EVCommunicationError',
    'GroundFailure',
    'HighTemperature',
    'InternalError',
    'OverCurrentFailure',
    'OverVoltage',
    'PowerMeterFailure',
    'PowerSwitchFailure',
    'ReaderFailure',
    'ResetFailure',
    'UnderVoltage',
    'WeakSignal',
] as const;

interface Props {
    device: DeviceWithRuntime;
}

/**
 * Manual controls: the set of things a person does at a real charger.
 * Buttons emit OCPP traffic via the simulator's action endpoints. The
 * UI doesn't track its own state — every action invalidates the device
 * query so the connector status badge updates from the server.
 */
export function ManualControls({ device }: Props) {
    const qc = useQueryClient();
    const online = device.online;

    const [connectorId, setConnectorId] = useState<number>(device.connectors[0]?.id ?? 1);
    const [idTag, setIdTag] = useState('TEST-TAG-001');
    const [faultCode, setFaultCode] = useState<string>('OtherError');
    const [autoClear, setAutoClear] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<'emergency' | 'hard-reboot' | null>(null);

    // Derive the live connector status. WS pushes update the live store
    // immediately on plug-in / plug-out / fault, so the active button
    // reflects the device's actual state, not just what we last asked for.
    const liveStatus = useLiveStore((s) => s.connectorStatus.get(liveKey(device.id, connectorId)));
    const status = liveStatus ?? device.connectors.find((c) => c.id === connectorId)?.status ?? 'Available';
    const isPluggedIn = status !== 'Available' && status !== 'Faulted' && status !== 'Unavailable';
    const isCharging = status === 'Charging';
    const isFaulted = status === 'Faulted';

    const invalidate = () => {
        qc.invalidateQueries({ queryKey: ['devices'] });
        qc.invalidateQueries({ queryKey: ['devices', device.id] });
        qc.invalidateQueries({ queryKey: ['sessions'] });
    };

    const onErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

    const m = {
        plugIn: useMutation({
            mutationFn: () => api.plugIn(device.id, connectorId),
            onSuccess: invalidate,
            onError: onErr,
        }),
        plugOut: useMutation({
            mutationFn: () => api.plugOut(device.id, connectorId),
            onSuccess: invalidate,
            onError: onErr,
        }),
        swipe: useMutation({
            mutationFn: () => api.swipe(device.id, connectorId, idTag.trim() || 'TEST-TAG-001'),
            onSuccess: invalidate,
            onError: onErr,
        }),
        fault: useMutation({
            mutationFn: () =>
                api.injectFault(device.id, {
                    connectorId,
                    errorCode: faultCode,
                    clearAfterSeconds: autoClear ? Number(autoClear) : undefined,
                }),
            onSuccess: invalidate,
            onError: onErr,
        }),
        clearFault: useMutation({
            mutationFn: () => api.clearFault(device.id, connectorId),
            onSuccess: invalidate,
            onError: onErr,
        }),
        emergencyStop: useMutation({
            mutationFn: () => api.emergencyStop(device.id),
            onSuccess: invalidate,
            onError: onErr,
        }),
        rebootSoft: useMutation({
            mutationFn: () => api.reboot(device.id, 'Soft'),
            onSuccess: invalidate,
            onError: onErr,
        }),
        rebootHard: useMutation({
            mutationFn: () => api.reboot(device.id, 'Hard'),
            onSuccess: invalidate,
            onError: onErr,
        }),
    };

    const anyPending = Object.values(m).some((mut) => mut.isPending);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Wrench className="h-4 w-4" /> Manual controls
                    </CardTitle>
                    <Badge variant={online ? 'online' : 'offline'}>{online ? 'Online' : 'Offline'}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Connector picker (only matters for multi-connector devices) */}
                {device.connectors.length > 1 && (
                    <div className="grid grid-cols-2 gap-2 max-w-xs">
                        <div className="space-y-1.5">
                            <Label htmlFor="connector-select" className="text-xs text-muted-foreground">
                                Connector
                            </Label>
                            <Select
                                value={String(connectorId)}
                                onValueChange={(v) => setConnectorId(Number(v))}
                            >
                                <SelectTrigger id="connector-select">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {device.connectors.map((c) => (
                                        <SelectItem key={c.id} value={String(c.id)}>
                                            Connector {c.id} — {c.status}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                <Section icon={<Plug className="h-3.5 w-3.5" />} title="Cable">
                    <Button
                        variant={isPluggedIn ? 'default' : 'outline'}
                        onClick={() => m.plugIn.mutate()}
                        disabled={!online || anyPending || isPluggedIn || isFaulted}
                        aria-pressed={isPluggedIn}
                    >
                        <Plug className="h-4 w-4" /> Plug in
                    </Button>
                    <Button
                        variant={!isPluggedIn ? 'default' : 'outline'}
                        onClick={() => m.plugOut.mutate()}
                        disabled={!online || anyPending || (!isPluggedIn && !isCharging)}
                        aria-pressed={!isPluggedIn}
                    >
                        <Plug className="h-4 w-4 rotate-180" /> Plug out
                    </Button>
                    <span className="text-xs text-muted-foreground ml-1">
                        {isFaulted ? 'Connector faulted' : isPluggedIn ? 'Cable plugged in' : 'No cable'}
                    </span>
                </Section>

                <Separator />

                <Section icon={<CreditCard className="h-3.5 w-3.5" />} title="RFID swipe">
                    <div className="flex gap-2 w-full max-w-md">
                        <Input
                            value={idTag}
                            onChange={(e) => setIdTag(e.target.value)}
                            placeholder="ID tag"
                            disabled={anyPending}
                        />
                        <Button onClick={() => m.swipe.mutate()} disabled={!online || anyPending}>
                            <CreditCard className="h-4 w-4" /> Swipe
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Same tag swipe stops a running session; first swipe with a fresh tag starts one.
                    </p>
                </Section>

                <Separator />

                <Section icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Fault injection">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-2xl">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Error code</Label>
                            <Select value={faultCode} onValueChange={setFaultCode}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FAULT_CODES.map((c) => (
                                        <SelectItem key={c} value={c}>
                                            {c}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Auto-clear (seconds)</Label>
                            <Input
                                type="number"
                                value={autoClear}
                                onChange={(e) => setAutoClear(e.target.value)}
                                placeholder="(none)"
                                min="0"
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <Button
                                variant="destructive"
                                onClick={() => m.fault.mutate()}
                                disabled={!online || anyPending}
                            >
                                <AlertTriangle className="h-4 w-4" /> Inject
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => m.clearFault.mutate()}
                                disabled={anyPending}
                            >
                                Clear
                            </Button>
                        </div>
                    </div>
                </Section>

                <Separator />

                <Section icon={<Zap className="h-3.5 w-3.5" />} title="Lifecycle">
                    <Button
                        variant="destructive"
                        onClick={() => setConfirming('emergency')}
                        disabled={anyPending}
                    >
                        <AlertOctagon className="h-4 w-4" /> Emergency stop
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => m.rebootSoft.mutate()}
                        disabled={!online || anyPending}
                    >
                        <RefreshCw className="h-4 w-4" /> Soft reboot
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setConfirming('hard-reboot')}
                        disabled={anyPending}
                    >
                        <PlugZap className="h-4 w-4" /> Hard reboot
                    </Button>
                </Section>

                <ConfirmDialog
                    open={confirming === 'emergency'}
                    onOpenChange={(o) => {
                        if (!o) setConfirming(null);
                    }}
                    title="Emergency stop"
                    description="This stops every active charging session on the device immediately. The CSMS sees an EmergencyStop reason on the StopTransaction."
                    confirmText="Trigger stop"
                    destructive
                    pending={m.emergencyStop.isPending}
                    onConfirm={() => {
                        m.emergencyStop.mutate();
                        setConfirming(null);
                    }}
                />
                <ConfirmDialog
                    open={confirming === 'hard-reboot'}
                    onOpenChange={(o) => {
                        if (!o) setConfirming(null);
                    }}
                    title="Hard reboot"
                    description="A hard reboot aborts every active session and tears the OCPP socket down. Use only when the simulated charger is wedged."
                    confirmText="Reboot"
                    destructive
                    pending={m.rebootHard.isPending}
                    onConfirm={() => {
                        m.rebootHard.mutate();
                        setConfirming(null);
                    }}
                />

                {error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                        {error}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                {icon}
                {title}
            </div>
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    );
}
