import { cn } from '@/lib/cn';

/**
 * Small status pip, optionally pulsing. Used inside badges for
 * "Online" or "Charging" so the eye picks up live state at a glance.
 *
 *   pulse: animate the green ring (live state)
 *   tone: green | gray | orange | red — color of the inner dot
 */
export function LiveDot({
    pulse = false,
    tone = 'green',
    className,
}: {
    pulse?: boolean;
    tone?: 'green' | 'gray' | 'orange' | 'red';
    className?: string;
}) {
    const bg = {
        green: 'bg-brand-green',
        gray: 'bg-zinc-400',
        orange: 'bg-brand-orange',
        red: 'bg-brand-red',
    }[tone];
    return (
        <span
            className={cn(
                'inline-block h-2 w-2 rounded-full',
                bg,
                pulse && 'pulse-live',
                className,
            )}
        />
    );
}
