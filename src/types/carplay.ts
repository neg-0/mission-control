// -----------------------------------------------------------------------------
// CarPlay API response types
// -----------------------------------------------------------------------------

export interface CarPlayHomeData {
  rocketDigest: string | null;
  topProjects: CarPlayProjectCard[];
  fleetHealth: CarPlayFleetHealth;
  burningTasks: CarPlayTask[];
  prCiStatus: CarPlayPrCiStatus;
  mrrGauge: CarPlayMrrGauge;
  updatedAt: string;
}

export interface CarPlayProjectCard {
  id: string;
  name: string;
  statusColor: 'green' | 'yellow' | 'red' | 'gray';
  nextAction: string | null;
  blockersCount: number;
}

export interface CarPlayFleetHealth {
  active: number;
  total: number;
  blocked: number;
  healthColor: 'green' | 'yellow' | 'red';
}

export interface CarPlayTask {
  id: string;
  title: string;
  priority: string;
  projectName: string | null;
}

export interface CarPlayPrCiStatus {
  total: number;
  passing: number;
  failing: number;
  pending: number;
}

export interface CarPlayMrrGauge {
  current: number;
  burnRate: number;
  runway: number | null;
  /** 0-100 on log10 scale, where 100 = $1M MRR */
  logScalePercent: number;
}

export interface CarPlayProjectDetail {
  projectName: string;
  stage: string;
  todayProgress: {
    tasksCompleted: number;
    tasksPending: number;
    percentComplete: number;
  };
  topBlockers: Array<{ id: string; title: string; severity: string }>;
  nextTasks: Array<{ id: string; title: string; priority: string; status: string }>;
}

export interface CarPlayAlertResponse {
  id: string;
  severity: number;
  type: string;
  title: string;
  detail: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  repeatCount: number;
}
