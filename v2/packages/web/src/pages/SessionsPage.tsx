import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

export function SessionsPage() {
    const { data: sessions = [] } = useQuery({
        queryKey: ['sessions'],
        queryFn: () => api.listSessions({ limit: 200 }),
    });

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold">Sessions</h1>
                <p className="text-sm text-muted-foreground">All charging sessions, newest first.</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Recent ({sessions.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="px-4 py-2 text-left">Status</th>
                                <th className="px-4 py-2 text-left">Device</th>
                                <th className="px-4 py-2 text-left">Conn</th>
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
                                                s.status === 'active' ? 'online' : s.status === 'completed' ? 'secondary' : 'destructive'
                                            }
                                        >
                                            {s.status}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">{s.deviceId}</td>
                                    <td className="px-4 py-2">{s.connectorId}</td>
                                    <td className="px-4 py-2 text-xs">{new Date(s.startedAt).toLocaleString()}</td>
                                    <td className="px-4 py-2 text-xs">{s.endedAt ? new Date(s.endedAt).toLocaleString() : '—'}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{(s.energyWh / 1000).toFixed(3)} kWh</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{s.peakPowerKw.toFixed(1)} kW</td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">{s.endReason ?? '—'}</td>
                                </tr>
                            ))}
                            {sessions.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                                        No sessions yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </div>
    );
}
