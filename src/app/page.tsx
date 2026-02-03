'use client';

import { 
  GitPullRequest, 
  Target, 
  Bot, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Send,
  Copy,
  RefreshCw,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { mockPRs, mockGoals, mockAlerts, mockAgents, mockStats } from '@/lib/mock-data';
import { useState } from 'react';

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    passing: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Passing' },
    failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Failed' },
    pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending' },
    approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
    changes_requested: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Changes' },
  };
  const c = config[status] || { bg: 'bg-gray-500/20', text: 'text-gray-400', label: status };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', c.bg, c.text)}>
      {c.label}
    </span>
  );
}

// Owner badge
function OwnerBadge({ owner }: { owner: string }) {
  const config: Record<string, { bg: string; emoji: string }> = {
    dustin: { bg: 'bg-purple-500/20 text-purple-400', emoji: '👤' },
    rocket: { bg: 'bg-blue-500/20 text-blue-400', emoji: '🚀' },
    jules: { bg: 'bg-pink-500/20 text-pink-400', emoji: '🤖' },
    gemini: { bg: 'bg-cyan-500/20 text-cyan-400', emoji: '✨' },
    ci: { bg: 'bg-yellow-500/20 text-yellow-400', emoji: '⏳' },
  };
  const c = config[owner] || { bg: 'bg-gray-500/20 text-gray-400', emoji: '❓' };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', c.bg)}>
      {c.emoji} {owner}
    </span>
  );
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

// Card component
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-card border border-border rounded-lg', className)}>
      {children}
    </div>
  );
}

// PR Row component
function PRRow({ pr }: { pr: typeof mockPRs[0] }) {
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-accent/50 rounded-lg transition-colors group">
      {/* CI Status Icon */}
      <div className="flex-shrink-0">
        {pr.ci === 'passing' && <CheckCircle2 className="w-5 h-5 text-green-400" />}
        {pr.ci === 'failed' && <XCircle className="w-5 h-5 text-red-400" />}
        {pr.ci === 'pending' && <Clock className="w-5 h-5 text-yellow-400 animate-pulse" />}
      </div>
      
      {/* PR Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">#{pr.id}</span>
          <span className="text-sm text-muted-foreground truncate">{pr.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">→ {pr.target}</span>
          {pr.unresolvedComments > 0 && (
            <span className="text-xs text-orange-400">💬 {pr.unresolvedComments} unresolved</span>
          )}
        </div>
      </div>
      
      {/* Status & Owner */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <StatusBadge status={pr.reviewState} />
        <OwnerBadge owner={pr.owner} />
      </div>
      
      {/* Actions (visible on hover/mobile) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button className="p-1.5 hover:bg-primary/20 rounded" title="Kick to Rocket">
          <Send className="w-4 h-4 text-primary" />
        </button>
        <button className="p-1.5 hover:bg-muted rounded" title="Copy summary">
          <Copy className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

// Goal Row component
function GoalRow({ goal }: { goal: typeof mockGoals[0] }) {
  return (
    <div className="p-3 hover:bg-accent/50 rounded-lg transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{goal.id}</span>
          <span className="text-sm font-medium">{goal.title}</span>
        </div>
        <OwnerBadge owner={goal.owner} />
      </div>
      
      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
        <div 
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${goal.progress}%` }}
        />
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{goal.progress}% complete</span>
        {goal.blockers.length > 0 && (
          <span className="text-orange-400">⚠️ {goal.blockers[0]}</span>
        )}
      </div>
    </div>
  );
}

// Alert Row component  
function AlertRow({ alert }: { alert: typeof mockAlerts[0] }) {
  return (
    <div className="flex items-start gap-3 p-3 hover:bg-accent/50 rounded-lg transition-colors">
      <AlertLevel level={alert.level} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{alert.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{alert.description}</div>
      </div>
      <button className="text-xs text-primary hover:underline flex-shrink-0">
        {alert.action}
      </button>
    </div>
  );
}

// Stats card
function StatCard({ label, value, icon: Icon, trend }: { 
  label: string; 
  value: number | string; 
  icon: any;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
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
    </div>
  );
}

export default function MissionControl() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'prs' | 'goals' | 'alerts'>('prs');

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🚀</span>
            <h1 className="font-bold text-lg">Mission Control</h1>
          </div>
          
          {/* System Status */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">All Systems Nominal</span>
            </div>
            <button className="p-2 hover:bg-accent rounded-lg">
              <RefreshCw className="w-4 h-4" />
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

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="PRs Open" value={mockStats.prsOpen} icon={GitPullRequest} />
          <StatCard label="Ready to Merge" value={mockStats.prsReadyToMerge} icon={CheckCircle2} trend="up" />
          <StatCard label="Blocked" value={mockStats.prsBlocked} icon={XCircle} trend="down" />
          <StatCard label="Goals Active" value={mockStats.goalsActive} icon={Target} />
        </div>

        {/* Mobile Tab Selector */}
        <div className="md:hidden flex gap-2 mb-4 overflow-x-auto pb-2">
          {(['prs', 'goals', 'alerts'] as const).map((tab) => (
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
              {tab === 'prs' && '📋 PRs'}
              {tab === 'goals' && '🎯 Goals'}
              {tab === 'alerts' && '🚨 Alerts'}
            </button>
          ))}
        </div>

        {/* Main Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* PR Queue */}
          <Card className={cn(
            'md:col-span-2',
            activeTab !== 'prs' && 'hidden md:block'
          )}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitPullRequest className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">PR Queue</h2>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                  {mockPRs.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select className="text-xs bg-accent border border-border rounded px-2 py-1">
                  <option>All PRs</option>
                  <option>My PRs</option>
                  <option>Needs Action</option>
                  <option>Blocked</option>
                </select>
              </div>
            </div>
            <div className="p-2 max-h-[500px] overflow-y-auto">
              {mockPRs.map((pr) => (
                <PRRow key={pr.id} pr={pr} />
              ))}
            </div>
          </Card>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Alerts */}
            <Card className={cn(activeTab !== 'alerts' && 'hidden md:block')}>
              <div className="p-4 border-b border-border flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-400" />
                <h2 className="font-semibold">Alerts</h2>
                {mockAlerts.filter(a => a.level === 'red').length > 0 && (
                  <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                    {mockAlerts.filter(a => a.level === 'red').length} critical
                  </span>
                )}
              </div>
              <div className="p-2">
                {mockAlerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </div>
            </Card>

            {/* Goals */}
            <Card className={cn(activeTab !== 'goals' && 'hidden md:block')}>
              <div className="p-4 border-b border-border flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Active Goals</h2>
              </div>
              <div className="p-2">
                {mockGoals.map((goal) => (
                  <GoalRow key={goal.id} goal={goal} />
                ))}
              </div>
            </Card>

            {/* Agents */}
            <Card>
              <div className="p-4 border-b border-border flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Sub-Agents</h2>
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                  {mockAgents.filter(a => a.status === 'completed').length} completed
                </span>
              </div>
              <div className="p-3">
                {mockAgents.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No active agents
                  </div>
                ) : (
                  mockAgents.map((agent) => (
                    <div key={agent.id} className="flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{agent.id}</div>
                        <div className="text-xs text-muted-foreground">{agent.task}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{agent.completedAt}</div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
