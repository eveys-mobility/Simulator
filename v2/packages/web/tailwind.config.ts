import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
    darkMode: ['class'],
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    // Belt-and-suspenders for utilities Tailwind's content scanner has
    // missed in the past (popover, accent variants used inside Radix
    // Portal-rendered subtrees). Cheap to keep.
    safelist: [
        'bg-popover',
        'text-popover-foreground',
        'bg-accent',
        'text-accent-foreground',
        'bg-destructive',
        'text-destructive-foreground',
    ],
    theme: {
        extend: {
            colors: {
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))',
                },
                brand: {
                    orange: 'hsl(var(--brand-orange))',
                    slate: 'hsl(var(--brand-slate))',
                    cloud: 'hsl(var(--brand-cloud))',
                    green: 'hsl(var(--brand-green))',
                    blue: 'hsl(var(--brand-blue))',
                    red: 'hsl(var(--brand-red))',
                },
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
            fontFamily: {
                sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
                display: ['Clash Display', 'Inter Variable', 'system-ui', 'sans-serif'],
            },
        },
    },
    plugins: [animate],
};

export default config;
