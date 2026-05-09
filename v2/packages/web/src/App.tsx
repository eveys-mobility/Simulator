import { Activity, Cpu, Layers, Settings, Zap } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/cn';
import { useApplyTheme } from '@/lib/theme';
import { useLiveWs } from '@/lib/use-live-ws';
import { DeviceDetailPage } from '@/pages/DeviceDetailPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { FleetPage } from '@/pages/FleetPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { SettingsPage } from '@/pages/SettingsPage';

export default function App() {
    useApplyTheme();
    useLiveWs();

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b border-border/60 backdrop-blur-md bg-background/80 sticky top-0 z-40">
                <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-orange text-white shadow-md shadow-brand-orange/30">
                            <Zap className="h-4 w-4" strokeWidth={2.5} />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="font-display text-lg font-semibold tracking-tight">eveys</span>
                            <span className="text-sm font-medium text-muted-foreground">OCPP Simulator</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <nav className="flex gap-1">
                            <NavItem to="/devices">
                                <Cpu className="h-4 w-4" /> Devices
                            </NavItem>
                            <NavItem to="/fleet">
                                <Layers className="h-4 w-4" /> Fleet
                            </NavItem>
                            <NavItem to="/sessions">
                                <Activity className="h-4 w-4" /> Sessions
                            </NavItem>
                            <NavItem to="/settings">
                                <Settings className="h-4 w-4" /> Settings
                            </NavItem>
                        </nav>
                        <ThemeToggle />
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
                <Routes>
                    <Route path="/" element={<Navigate to="/devices" replace />} />
                    <Route path="/devices" element={<DevicesPage />} />
                    <Route path="/devices/:id" element={<DeviceDetailPage />} />
                    <Route path="/fleet" element={<FleetPage />} />
                    <Route path="/sessions" element={<SessionsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
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
                        ? 'bg-brand-orange/15 text-brand-orange ring-1 ring-brand-orange/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
                )
            }
        >
            {children}
        </NavLink>
    );
}
