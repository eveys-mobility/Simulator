import { Activity, Cpu } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useLiveWs } from '@/lib/use-live-ws';
import { DeviceDetailPage } from '@/pages/DeviceDetailPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { SessionsPage } from '@/pages/SessionsPage';

export default function App() {
    useLiveWs();

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b">
                <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Cpu className="h-5 w-5 text-primary" />
                        <span className="font-semibold">OCPP Simulator</span>
                        <span className="text-xs text-muted-foreground">v2</span>
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
                    isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
                )
            }
        >
            {children}
        </NavLink>
    );
}
