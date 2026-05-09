import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export function SettingsPage() {
    const qc = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['settings'],
        queryFn: api.getSettings,
    });

    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // Seed the input once data lands; later refetches don't clobber an
    // in-progress edit.
    useEffect(() => {
        if (data && draft === '') setDraft(data.defaultOcppUrl);
    }, [data, draft]);

    const save = useMutation({
        mutationFn: (defaultOcppUrl: string) => api.updateSettings({ defaultOcppUrl }),
        onSuccess: (res) => {
            setError(null);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            setDraft(res.defaultOcppUrl);
            qc.invalidateQueries({ queryKey: ['settings'] });
        },
        onError: (e) => {
            setError(e instanceof Error ? e.message : String(e));
            setSaved(false);
        },
    });

    const dirty = data ? draft !== data.defaultOcppUrl : false;

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="text-2xl font-semibold">Settings</h1>
                <p className="text-sm text-muted-foreground">
                    Simulator-wide preferences. Per-device options live on each device's edit dialog.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">OCPP gateway</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        New devices connect to this WebSocket URL by default. Existing devices keep their own
                        URL until you edit them — this only affects the next device you create.
                    </p>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!dirty) return;
                            try {
                                new URL(draft);
                            } catch {
                                setError('Not a valid URL');
                                return;
                            }
                            save.mutate(draft);
                        }}
                        className="space-y-2"
                    >
                        <Label htmlFor="default-ocpp-url">Default OCPP URL</Label>
                        <div className="flex gap-2">
                            <Input
                                id="default-ocpp-url"
                                type="url"
                                value={isLoading ? 'loading…' : draft}
                                onChange={(e) => {
                                    setDraft(e.target.value);
                                    setError(null);
                                }}
                                placeholder="ws://gateway.example:19000"
                                disabled={isLoading || save.isPending}
                                className="font-mono text-sm"
                            />
                            <Button type="submit" disabled={!dirty || save.isPending}>
                                <Save className="h-4 w-4" />
                                {save.isPending ? 'Saving…' : 'Save'}
                            </Button>
                        </div>

                        {saved && (
                            <p className="text-sm text-brand-green">Saved.</p>
                        )}
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
