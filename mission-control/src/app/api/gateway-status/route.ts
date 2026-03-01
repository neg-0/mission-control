import { exec } from 'child_process';
import { NextResponse } from 'next/server';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface GatewayStatus {
  online: boolean;
  status: 'running' | 'failed' | 'stopped' | 'restarting' | 'unknown';
  restartCount: number;
  uptime: string | null;
  logs: string[];
}

async function pingGateway(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:18789', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function getSystemdStatus(): Promise<{
  activeState: string;
  nRestarts: number;
  uptime: string | null;
}> {
  try {
    const { stdout } = await execAsync(
      'systemctl --user show openclaw-gateway.service --property=ActiveState,NRestarts,ActiveEnterTimestamp --no-pager'
    );
    const props: Record<string, string> = {};
    for (const line of stdout.trim().split('\n')) {
      const [key, ...rest] = line.split('=');
      props[key] = rest.join('=');
    }

    let uptime: string | null = null;
    if (props.ActiveEnterTimestamp && props.ActiveState === 'active') {
      const entered = new Date(props.ActiveEnterTimestamp).getTime();
      const diffMs = Date.now() - entered;
      const secs = Math.floor(diffMs / 1000);
      if (secs < 60) uptime = `${secs}s`;
      else if (secs < 3600) uptime = `${Math.floor(secs / 60)}m ${secs % 60}s`;
      else uptime = `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
    }

    return {
      activeState: props.ActiveState || 'unknown',
      nRestarts: parseInt(props.NRestarts || '0', 10),
      uptime,
    };
  } catch {
    return { activeState: 'unknown', nRestarts: 0, uptime: null };
  }
}

async function getJournalLogs(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      'journalctl --user -u openclaw-gateway.service -n 20 --no-pager --output=short-iso 2>/dev/null'
    );
    return stdout
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
  } catch {
    return ['(Unable to read gateway logs)'];
  }
}

export async function GET() {
  const [online, systemd, logs] = await Promise.all([
    pingGateway(),
    getSystemdStatus(),
    getJournalLogs(),
  ]);

  let status: GatewayStatus['status'];
  switch (systemd.activeState) {
    case 'active':
      status = 'running';
      break;
    case 'failed':
      status = 'failed';
      break;
    case 'inactive':
    case 'dead':
      status = 'stopped';
      break;
    case 'activating':
    case 'deactivating':
    case 'reloading':
      status = 'restarting';
      break;
    default:
      status = 'unknown';
  }

  // If systemd says active but ping fails, it's likely still starting
  if (status === 'running' && !online) {
    status = 'restarting';
  }

  const result: GatewayStatus = {
    online,
    status,
    restartCount: systemd.nRestarts,
    uptime: systemd.uptime,
    logs,
  };

  return NextResponse.json(result);
}
