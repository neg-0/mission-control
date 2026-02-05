'use client';

import { useState, useEffect } from 'react';
import { 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Menu,
  X,
  Settings,
  Zap,
  GitPullRequest
} from 'lucide-react';
import { cn } from '../lib/utils';
import { FileBrowser } from '../components/FileBrowser';
import { GoalsTracker } from '../components/GoalsTracker';
import { SubAgentsPanel } from '../components/SubAgentsPanel';
import { PRQueue } from '../components/PRQueue';
import { useGatewayStream } from '../hooks/useGatewayStream';

// Alert data (will be computed from real sources)
interface Alert {
  id: string;
  level: 'red' | 'yellow' | 'green';
  title: string;
  description: string;
  action: string;
  link?: string;
}

// Alert level indicator
function AlertLevel({ level }: { level: string }) {
  const config: Record<string, string> = {
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
  };
  return (
    <div className={cn('w-2 h-2 rounded-full animate-pulse', config[level] || 'bg-gray-500')} />
  );
}

// Alert Row component  
function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex items-start gap-3 p-3 hover:bg-accent/50 rounded-lg transition-colors">
      <AlertLevel level={alert.level} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{alert.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{alert.description}</div>
      </div>
      {alert.link ? (
        <a 
          href={alert.link} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex-shrink-0"
        >
          {alert.action}
        </a>
      ) : (
        <button className="text-xs text-primary hover:underline flex-shrink-0">
          {alert.action}
        </button>
      )}
    </div>
  );
}

// Stats card
function StatCard({ label, value, icon: Icon, trend, onClick }: { 
  label: string; 
  value: number | string; 
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
}) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        'bg-card border border-border rounded-lg p-4 text-left transition-colors',
        onClick && 'hover:border-primary/50 cursor-pointer'
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 text-muted-foreground" />
        <span className={cn(
          'text-2xl font-bold',
          trend === 'up' && 'text-green-400',
          trend === 'down' && 'text-red-400'
        )}>
          {value}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-2">{label}</div>
    </button>
  );
}

// Quick command bar
function QuickCommand() {
  const [command, setCommand] = useState('');
  
  async function handleCommand(cmd: string) {
    console.log('Execute command:', cmd);
    // TODO: Send to session or execute action
    setCommand('');
  }
  
  return (
    <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2">
      <Zap className="w-4 h-4 text-primary" />
      <input
        type="text"
        placeholder="Quick command... (e.g., 'check PR 266', 'spawn research agent')"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && command.trim()) {
            handleCommand(command.trim());
          }
        }}
      />
    </div>
  );
}

export default function MissionControl() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'prs' | 'goals'>('goals');
  const [alerts, setAlerts] = useState<Alert[]>([
    { id: '1', level: 'green', title: 'ShipLog deployed', description: 'api.shiplog.io is live', action: 'Check', link: 'https://api.shiplog.io' },
  ]);

  // Gateway connection for real-time updates
  const { connected, connecting, error: gatewayError } = useGatewayStream({
    onEvent: (event) => {
      console.log('[Gateway Event]', event);
    },
  });

  // Stats (will be computed from real data)
  const [stats, setStats] = useState({
    prsOpen: 0,
    prsReadyToMerge: 0,
    prsBlocked: 0,
    agentsActive: 0,
  });

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🚀</span>
            <h1 className="font-bold text-lg">Mission Control</h1>
          </div>
          
          {/* System Status */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 rounded-full',
                connected ? 'bg-green-500' : connecting ? 'bg-yellow-500 animate-pulse' : 'bg-gray-500'
              )} />
              <span className="text-sm text-muted-foreground">
                {connected ? 'Live' : connecting ? 'Connecting...' : 'Offline'}
              </span>
            </div>
            <button className="p-2 hover:bg-accent rounded-lg" title="Settings">
              <Settings className="w-4 h-4" />
            </button>
          </div>
          
          {/* Mobile menu toggle */}
          <button 
            className="md:hidden p-2 hover:bg-accent rounded-lg"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {/* Quick Command Bar */}
        <div className="mb-4">
          <QuickCommand />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="PRs Open" value={stats.prsOpen || '—'} icon={GitPullRequest} />
          <StatCard label="Ready to Merge" value={stats.prsReadyToMerge || '—'} icon={CheckCircle2} trend={stats.prsReadyToMerge > 0 ? 'up' : undefined} />
          <StatCard label="Blocked" value={stats.prsBlocked || '—'} icon={XCircle} trend={stats.prsBlocked > 0 ? 'down' : undefined} />
          <StatCard label="Agents Active" value={stats.agentsActive || '—'} icon={Zap} />
        </div>

        {/* Mobile Tab Selector */}
        <div className="md:hidden flex gap-2 mb-4 overflow-x-auto pb-2">
          {(['goals', 'files', 'prs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === tab 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-accent text-muted-foreground'
              )}
            >
              {tab === 'files' && '📁 Files'}
              {tab === 'prs' && '📋 PRs'}
              {tab === 'goals' && '🎯 Goals'}
            </button>
          ))}
        </div>

        {/* Main 3-Column Grid */}
        <div className="grid md:grid-cols-12 gap-4">
          {/* Left Column: Files */}
          <div className={cn(
            'md:col-span-3',
            activeTab !== 'files' && 'hidden md:block'
          )}>
            <FileBrowser className="h-[600px]" />
          </div>

          {/* Center Column: Goals + Sub-Agents */}
          <div className={cn(
            'md:col-span-5 space-y-4',
            activeTab !== 'goals' && 'hidden md:block'
          )}>
            <GoalsTracker />
            <SubAgentsPanel />
          </div>

          {/* Right Column: PRs + Alerts */}
          <div className={cn(
            'md:col-span-4 space-y-4',
            activeTab !== 'prs' && 'hidden md:block'
          )}>
            <PRQueue />

            {/* Alerts */}
            {alerts.length > 0 && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="p-3 border-b border-border flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-400" />
                  <h2 className="font-semibold">Alerts</h2>
                </div>
                <div className="p-2">
                  {alerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-card border-t border-border px-4 py-2">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className={cn(
              connected ? 'text-green-400' : 'text-gray-400'
            )}>
              {connected ? '🟢' : '⚪'} Gateway: {connected ? 'Connected' : 'Disconnected'}
            </span>
            <span>📁 /home/node/.openclaw/workspace</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Last sync: just now</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Force dynamic rendering (uses hooks)
export const dynamic = 'force-dynamic';
