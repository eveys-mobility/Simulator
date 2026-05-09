import { Activity, Cpu, Zap } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useLiveWs } from '@/lib/use-live-ws';
import { DeviceDetailPage } from '@/pages/DeviceDetailPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { SessionsPage } from '@/pages/SessionsPage';

export default function App() {
    useLiveWs();

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-brand-navy/40">
            <header className="border-b border-border/60 backdrop-blur-md bg-background/70 sticky top-0 z-40">
                <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-blue text-white shadow-md shadow-brand-blue/30">
                            <Zap className="h-4 w-4" strokeWidth={2.5} />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="font-display text-lg font-semibold tracking-tight">eveys</span>
                            <span className="text-sm font-medium text-muted-foreground">OCPP Simulator</span>
                        </div>
                    </div>
                    <nav className="flex gap-1">
                        <NavItem to="/devices">
                            <Cpu className="h-4 w-4" /> Devices
                        </NavItem>
                        <NavItem to="/sessions">
                            <Activity className="h-4 w-4" /> Sessions
                        </NavItem>
                    </nav>
                </div>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
                <Routes>
                    <Route path="/" element={<Navigate to="/devices" replace />} />
                    <Route path="/devices" element={<DevicesPage />} />
                    <Route path="/devices/:id" element={<DeviceDetailPage />} />
                    <Route path="/sessions" element={<SessionsPage />} />
                </Routes>
            </main>
        </div>
    );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                        ? 'bg-brand-blue/15 text-brand-blue ring-1 ring-brand-blue/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
                )
            }
        >
            {children}
        </NavLink>
    );
}
