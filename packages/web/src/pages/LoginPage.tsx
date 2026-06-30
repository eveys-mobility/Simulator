import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Zap } from 'lucide-react';
import { type FormEvent, useState } from 'react';

interface LoginPageProps {
    onSubmit: (token: string) => Promise<boolean>;
    error: string | null;
}

/**
 * Shown only when AUTH_TOKEN is set on the backend and the browser
 * doesn't have a valid token yet. Single-field form: paste the bearer
 * token, hit Sign in, the gate verifies against /api/devices and either
 * unlocks the app or surfaces the error.
 */
export function LoginPage({ onSubmit, error }: LoginPageProps) {
    const [token, setToken] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!token.trim() || submitting) return;
        setSubmitting(true);
        try {
            await onSubmit(token.trim());
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-background">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-orange text-white shadow-md shadow-brand-orange/30">
                        <Zap className="h-5 w-5" strokeWidth={2.5} />
                    </div>
                    <CardTitle className="flex items-center gap-2 text-xl">
                        <Lock className="h-5 w-5" />
                        Sign in
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                        This simulator is protected with an access token. Paste it below to
                        continue.
                    </p>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="token">Access token</Label>
                            <Input
                                id="token"
                                type="password"
                                autoFocus
                                autoComplete="off"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                placeholder="paste the AUTH_TOKEN value"
                            />
                        </div>
                        {error && (
                            <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
                                {error}
                            </div>
                        )}
                        <Button
                            type="submit"
                            disabled={!token.trim() || submitting}
                            className="w-full"
                        >
                            {submitting ? 'Verifying…' : 'Sign in'}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            The token is whatever value the operator started the server with via{' '}
                            <code className="px-1 py-0.5 rounded bg-secondary/40 text-foreground">
                                AUTH_TOKEN
                            </code>
                            .
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
