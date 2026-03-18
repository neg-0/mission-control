'use client';

import {
  AlertTriangle,
  BarChart3,
  Bot,
  Flame,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  Rocket,
  Server,
  Settings,
  ListTodo,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from '../contexts/DashboardContext';
import { CronHealth } from './CronHealth';
import GatewayOfflineBanner from './GatewayOfflineBanner';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'War Room', icon: LayoutDashboard, emoji: '🎯' },
  { href: '/factory', label: 'Factory', icon: Lightbulb, emoji: '💡' },
  { href: '/fleet', label: 'Fleet', icon: Bot, emoji: '🤖' },
  { href: '/projects', label: 'Projects', icon: Rocket, emoji: '🚀' },
  { href: '/tasks', label: 'Tasks', icon: ListTodo, emoji: '📋' },
  { href: '/marketing', label: 'Marketing', icon: Megaphone, emoji: '📣' },
  { href: '/infra', label: 'Infra', icon: Server, emoji: '☁️' },
  { href: '/settings', label: 'Settings', icon: Settings, emoji: '⚙️' },
] as const;

function MissionControlLogo() {
  return (
    <h1 className="select-none flex items-center gap-0">
      <span className="text-sm font-light tracking-[0.2em] uppercase text-foreground/70">
        Mission
      </span>
      <span className="mx-1.5 w-px h-4 bg-foreground/20" />
      <span className="text-base font-bold tracking-[0.15em] uppercase flex items-center">
        <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
          CONTR
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="inline-block -mx-0.5 relative top-px">
          <circle cx="12" cy="12" r="10" stroke="url(#radar-grad-nav)" strokeWidth="1.5" fill="none" opacity="0.6" />
          <circle cx="12" cy="12" r="6" stroke="url(#radar-grad-nav)" strokeWidth="1.5" fill="none" opacity="0.8" />
          <circle cx="12" cy="12" r="2" stroke="url(#radar-grad-nav)" strokeWidth="1.5" fill="none" />
          <circle cx="14" cy="10" r="2" fill="#22d3ee" className="animate-pulse" />
          <defs>
            <linearGradient id="radar-grad-nav" x1="0" y1="0" x2="24" y2="24">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
        </svg>
        <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
          L
        </span>
      </span>
    </h1>
  );
}

function StatusBar() {
  const { gatewayHealth, connected, connecting, lastSyncLabel, dashboardData } = useDashboard();

  const gwOk = gatewayHealth.online;
  const wsOk = connected;
  const orchOk = gatewayHealth.status === 'running';
  const overallColor = !gwOk ? 'led-red' : (!wsOk || !orchOk) ? 'led-yellow' : 'led-green';

  return (
    <footer className="fixed bottom-0 left-0 right-0 glass-card rounded-none border-x-0 border-b-0 px-4 py-2 z-40">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={cn('w-2 h-2 led led-pulse shrink-0', overallColor)} />
          <span className={cn(gatewayHealth.online ? 'text-emerald-400' : 'text-red-400')}>
            GW: {gatewayHealth.online ? 'OK' : 'Down'}
          </span>
          <span className="text-border">│</span>
          <span className={cn(connected ? 'text-emerald-400' : connecting ? 'text-yellow-400' : 'text-red-400')}>
            WS: {connected ? 'Connected' : connecting ? 'Connecting' : 'Disconnected'}
          </span>
          <span className="text-border">│</span>
          <span className={cn(
            gatewayHealth.status === 'running' ? 'text-emerald-400' :
              gatewayHealth.status === 'restarting' ? 'text-yellow-400' : 'text-red-400'
          )}>
            Orch: {gatewayHealth.status === 'running' ? 'Running' : gatewayHealth.status === 'unknown' ? '—' : gatewayHealth.status}
          </span>
          <span className="text-border hidden sm:inline">│</span>
          <span className="hidden sm:inline">Sync: {lastSyncLabel}</span>
          {dashboardData?.cron && (
            <>
              <span className="text-border hidden md:inline">│</span>
              <span className="hidden md:inline">
                <CronHealth total={dashboardData.cron.total} ok={dashboardData.cron.ok} errors={dashboardData.cron.errors} />
              </span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { gatewayHealth, alerts, booting } = useDashboard();

  const fireCount = alerts.filter(a => a.level === 'red').length;

  if (booting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center">
        <div className="mesh-bg fixed inset-0 -z-10"><div className="mesh-bg-accent" /></div>
        <div className="text-5xl mb-6 animate-pulse">🛰️</div>
        <h2 className="text-lg font-semibold tracking-widest uppercase text-foreground/90 mb-4" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
          Mission Control
        </h2>
        <div className="w-64 h-1 bg-muted rounded-full overflow-hidden mb-6">
          <div className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-full" style={{ animation: 'boot-bar 2s ease-out forwards' }} />
        </div>
        <div className="space-y-1 text-xs text-muted-foreground font-mono">
          <p style={{ animation: 'fade-in 0.5s ease-out forwards', animationDelay: '0ms', opacity: 0 }}>▸ Connecting to gateway…</p>
          <p style={{ animation: 'fade-in 0.5s ease-out forwards', animationDelay: '400ms', opacity: 0 }}>▸ Scanning workspaces…</p>
          <p style={{ animation: 'fade-in 0.5s ease-out forwards', animationDelay: '800ms', opacity: 0 }}>▸ Loading fleet telemetry…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground relative">
      <div className="mesh-bg fixed inset-0 -z-10"><div className="mesh-bg-accent" /></div>
      <GatewayOfflineBanner {...gatewayHealth} />

      {/* Sidebar */}
      <aside className="fixed top-0 left-0 bottom-0 w-[200px] glass-card rounded-none border-l-0 border-t-0 border-b-0 z-50 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-border/50">
          <MissionControlLogo />
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors mx-2 rounded-lg',
                  isActive
                    ? 'bg-primary/15 text-primary font-medium border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
                {item.label === 'War Room' && fireCount > 0 && (
                  <span className="ml-auto text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-mono">
                    {fireCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="px-4 py-3 border-t border-border/50 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className={cn('w-1.5 h-1.5 led', gatewayHealth.online ? 'led-green' : 'led-red')} />
            <span>{gatewayHealth.online ? 'Systems nominal' : 'Gateway offline'}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="ml-[200px] pb-12">
        {/* Top alert bar */}
        {alerts.some(a => a.level === 'red') && (
          <div className="mx-4 mt-4 glass-card px-4 py-3 flex items-center gap-3 glow-red text-red-200">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {alerts.find(a => a.level === 'red')!.message}
            </span>
          </div>
        )}

        <main className="max-w-[1400px] mx-auto px-4 py-4">
          {children}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
