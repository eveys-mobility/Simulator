import { useEffect } from 'react';
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ocpp-sim-theme';

interface ThemeState {
    mode: ThemeMode;
    setMode: (m: ThemeMode) => void;
}

const readInitialMode = (): ThemeMode => {
    if (typeof window === 'undefined') return 'system';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
};

export const useTheme = create<ThemeState>((set) => ({
    mode: readInitialMode(),
    setMode: (mode) => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, mode);
        }
        set({ mode });
    },
}));

const resolveDark = (mode: ThemeMode): boolean => {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

/**
 * Mounts a single effect that mirrors the chosen mode into the
 * `dark` class on the `<html>` element (Tailwind's class strategy)
 * and listens for OS-level changes when the mode is `system`.
 *
 * Place once at app root; subsequent reads come from `useTheme`.
 */
export function useApplyTheme() {
    const mode = useTheme((s) => s.mode);
    useEffect(() => {
        const root = document.documentElement;
        const apply = () => {
            if (resolveDark(mode)) root.classList.add('dark');
            else root.classList.remove('dark');
        };
        apply();
        if (mode !== 'system') return;
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        mql.addEventListener('change', apply);
        return () => mql.removeEventListener('change', apply);
    }, [mode]);
}
