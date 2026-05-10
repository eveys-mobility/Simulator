import { useEffect, useState } from 'react';

const TOKEN_KEY = 'ocpp-sim:token';

/**
 * Bearer token shared with the server when AUTH_TOKEN is set on the
 * backend. Stored in localStorage so a page reload keeps the user
 * logged in. Read synchronously from anywhere (the api.ts helper does)
 * — there's no React context dance needed for a single shared secret.
 */
export function getToken(): string | null {
    try {
        return window.localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setToken(token: string): void {
    try {
        window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
        // Private mode / disabled storage. Token won't survive reload
        // but the in-memory app state still works for this tab.
    }
}

export function clearToken(): void {
    try {
        window.localStorage.removeItem(TOKEN_KEY);
    } catch {}
}

export interface AuthState {
    /** Have we figured out yet whether the server requires auth? */
    ready: boolean;
    /** Server-side: is AUTH_TOKEN set? */
    required: boolean;
    /** Client-side: do we hold a token that the server has accepted? */
    authenticated: boolean;
    /** Last error message — usually "invalid token". */
    error: string | null;
}

/**
 * Probes /api/auth/ping (always open) to learn whether the backend
 * requires a token. If yes and we hold one, verifies by hitting the
 * gated /api/devices endpoint. The result drives whether the app
 * shows the login screen or the normal UI.
 */
export function useAuthGate(): AuthState & {
    login: (token: string) => Promise<boolean>;
    logout: () => void;
} {
    const [state, setState] = useState<AuthState>({
        ready: false,
        required: false,
        authenticated: false,
        error: null,
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const ping = await fetch('/api/auth/ping');
                const body = (await ping.json()) as { authRequired: boolean };
                if (cancelled) return;
                if (!body.authRequired) {
                    setState({ ready: true, required: false, authenticated: true, error: null });
                    return;
                }
                const token = getToken();
                if (!token) {
                    setState({ ready: true, required: true, authenticated: false, error: null });
                    return;
                }
                const verify = await fetch('/api/devices', {
                    headers: { authorization: `Bearer ${token}` },
                });
                if (cancelled) return;
                if (verify.ok) {
                    setState({ ready: true, required: true, authenticated: true, error: null });
                } else {
                    clearToken();
                    setState({
                        ready: true,
                        required: true,
                        authenticated: false,
                        error: 'Stored token is no longer valid — please sign in again.',
                    });
                }
            } catch (err) {
                if (cancelled) return;
                setState({
                    ready: true,
                    required: false,
                    authenticated: true,
                    error: `auth probe failed: ${(err as Error).message}`,
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const login = async (token: string): Promise<boolean> => {
        const verify = await fetch('/api/devices', {
            headers: { authorization: `Bearer ${token}` },
        });
        if (!verify.ok) {
            setState((s) => ({ ...s, error: 'Invalid token — request was rejected by the server.' }));
            return false;
        }
        setToken(token);
        setState({ ready: true, required: true, authenticated: true, error: null });
        return true;
    };

    const logout = (): void => {
        clearToken();
        setState({ ready: true, required: true, authenticated: false, error: null });
    };

    return { ...state, login, logout };
}
