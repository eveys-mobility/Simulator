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
                ac: 'border-transparent bg-brand-blue text-white',
                dc: 'border-transparent bg-brand-orange text-white',
                online: 'border-transparent bg-brand-green/15 text-brand-green ring-1 ring-brand-green/30',
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
