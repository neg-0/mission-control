'use client';

interface GlobalTickerProps {
  agents: number;
  projects: number;
  users: number;
  burnRate: number;
  totalFleet?: number;
}

export function GlobalTicker({ agents, projects, users, burnRate, totalFleet }: GlobalTickerProps) {
  const items = [
    { label: 'Reporting', value: `${agents}${totalFleet ? `/${totalFleet}` : ''}`, icon: '⚡' },
    { label: 'Projects', value: String(projects), icon: '📦' },
    { label: 'Users', value: String(users), icon: '👥' },
    { label: 'Burn Rate', value: `$${burnRate}/day`, icon: '🔥' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span>{item.icon}</span>
          <span className="text-muted-foreground">{item.label}:</span>
          <span className="font-semibold font-mono">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
