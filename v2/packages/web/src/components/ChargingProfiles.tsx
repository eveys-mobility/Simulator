import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { ChargingProfile } from '@ocpp-sim/core';

interface Props {
    deviceId: string;
}

/**
 * Read-only view of SmartCharging profiles installed on the device.
 * Profile management itself is CSMS-driven (SetChargingProfile /
 * ClearChargingProfile CALLs); this surface lets the user see what
 * the gateway has set so they can correlate it with the live MeterValues.
 */
export function ChargingProfiles({ deviceId }: Props) {
    const { data, isLoading } = useQuery({
        queryKey: ['charging-profiles', deviceId],
        queryFn: () => api.listChargingProfiles(deviceId),
        // Refetch periodically — there's no WS event for profile
        // installs since the CSMS owns the lifecycle. 10s is fine for
        // a debugging surface.
        refetchInterval: 10_000,
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Gauge className="h-4 w-4" /> SmartCharging profiles
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : !data || data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No charging profiles installed. The CSMS sets profiles via{' '}
                        <code className="font-mono text-xs bg-secondary/40 px-1 py-0.5 rounded">SetChargingProfile</code>;
                        the simulator clamps the live power output to whatever the active profile allows.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {data.map((row) => (
                            <ProfileRow key={`${row.connectorId}-${row.profile.chargingProfileId}-${row.profile.stackLevel}`} row={row} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function ProfileRow({ row }: { row: { connectorId: number; profile: ChargingProfile } }) {
    const { profile } = row;
    const period0 = profile.chargingSchedule.chargingSchedulePeriod[0];
    return (
        <div className="rounded-md border p-3 space-y-2 hover:border-brand-orange/40 transition-colors">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-xs">
                        #{profile.chargingProfileId}
                    </Badge>
                    <span className="text-sm font-medium">{profile.chargingProfilePurpose}</span>
                    <Badge variant="outline" className="text-xs">stack {profile.stackLevel}</Badge>
                    <Badge variant="outline" className="text-xs">{profile.chargingProfileKind}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                    Connector {row.connectorId === 0 ? 'all' : row.connectorId}
                </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Cell label="Initial limit" value={period0 ? `${period0.limit} ${profile.chargingSchedule.chargingRateUnit}` : '—'} />
                <Cell label="Periods" value={String(profile.chargingSchedule.chargingSchedulePeriod.length)} />
                <Cell label="Duration" value={profile.chargingSchedule.duration ? `${profile.chargingSchedule.duration}s` : '—'} />
                <Cell label="Tx" value={profile.transactionId !== undefined ? `#${profile.transactionId}` : '—'} />
            </div>
        </div>
    );
}

function Cell({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-foreground tabular-nums">{value}</div>
        </div>
    );
}
