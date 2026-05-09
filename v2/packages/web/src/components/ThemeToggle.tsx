import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type ThemeMode, useTheme } from '@/lib/theme';

const ICONS: Record<ThemeMode, React.ComponentType<{ className?: string }>> = {
    light: Sun,
    dark: Moon,
    system: Monitor,
};

const LABELS: Record<ThemeMode, string> = {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
};

/**
 * Theme picker. The trigger reflects the *chosen* mode (not the
 * resolved one), so the user sees what they selected — system shows
 * the monitor icon even on a dark OS.
 */
export function ThemeToggle() {
    const mode = useTheme((s) => s.mode);
    const setMode = useTheme((s) => s.setMode);
    const Icon = ICONS[mode];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Theme"
                    className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{LABELS[mode]}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-36">
                {(['light', 'dark', 'system'] as const).map((m) => {
                    const ItemIcon = ICONS[m];
                    return (
                        <DropdownMenuItem key={m} onClick={() => setMode(m)} className="gap-2">
                            <ItemIcon className="h-3.5 w-3.5" />
                            <span className="flex-1">{LABELS[m]}</span>
                            {mode === m && <Check className="h-3.5 w-3.5 text-brand-orange" />}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
