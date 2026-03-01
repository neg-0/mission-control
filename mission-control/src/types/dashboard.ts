export type FleetCard = {
  id: string;
  name: string;
  health: 'green' | 'yellow' | 'red';
  status: string;
  last_report: string;
  mrr: number;
  users: number;
  checklist_progress: number;
};

export type IdeaCard = {
  id: string;
  name: string;
  bluf: string;
  score: number;
  status: string;
  url?: string | null;
};

export type GlobalStats = {
  mrr_total: number;
  burn_rate_est: number;
  active_agents: number;
  active_projects: number;
  total_users: number;
};

export type MarketingStats = {
  traffic_daily: number;
  signups_daily: number;
  top_channel: string;
};

export type DashboardData = {
  updated_at: string;
  global: GlobalStats;
  pipeline: IdeaCard[];
  fleet: FleetCard[];
  marketing: MarketingStats;
};
