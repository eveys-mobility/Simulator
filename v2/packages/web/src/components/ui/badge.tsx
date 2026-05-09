import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
    'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
    {
        variants: {
            variant: {
                default: 'border-transparent bg-primary text-primary-foreground',
                secondary: 'border-transparent bg-secondary text-secondary-foreground',
                destructive: 'border-transparent bg-destructive text-destructive-foreground',
                outline: 'text-foreground',
                ac: 'border-transparent bg-blue-500 text-white',
                dc: 'border-transparent bg-amber-500 text-white',
                online: 'border-transparent bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
                offline: 'border-transparent bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30',
            },
        },
        defaultVariants: { variant: 'default' },
    },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
