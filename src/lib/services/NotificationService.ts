/**
 * NotificationService
 *
 * Lightweight bridge for external webhook delivery (Slack, Discord, generic).
 * Integrates with the MessageLog bus — every notification is logged via
 * POST /api/messages so it appears in the central audit trail.
 *
 * Designed to be superseded by Phase 3 cross-pod messaging.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal',
]);

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (BLOCKED_HOSTNAMES.has(parsed.hostname)) return false;
    // Block private IP ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

interface NotificationResult {
  success: boolean;
  messageLogId?: string;
  error?: string;
}

/**
 * Log the notification to the MessageLog bus.
 * Uses the internal API so all messages flow through the same audit trail.
 */
async function logToMessageBus(opts: {
  fromId: string;
  toId: string;
  channel: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromId: opts.fromId,
        toId: opts.toId,
        channel: opts.channel,
        subject: opts.subject,
        body: opts.body,
        status: 'sent',
        metadata: opts.metadata || null,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.id || null;
    }
    return null;
  } catch {
    console.error('[NotificationService] Failed to log to MessageBus');
    return null;
  }
}

export class NotificationService {
  /**
   * Send a Slack-formatted notification and log it to the MessageLog.
   */
  static async sendSlackNotification(
    webhookUrl: string,
    message: string,
    agentId?: string,
  ): Promise<NotificationResult> {
    if (!isValidWebhookUrl(webhookUrl)) {
      return { success: false, error: 'Invalid or restricted URL' };
    }

    const fromId = agentId || 'system';
    const slackText = `🚀 *Mission Control Update*\n*Agent:* ${fromId}\n*Status:* ${message}`;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: slackText, icon_emoji: ':robot_face:' }),
      });

      const messageLogId = await logToMessageBus({
        fromId,
        toId: 'external:slack',
        channel: 'escalation',
        subject: 'Slack webhook notification',
        body: message,
        metadata: { webhookHost: new URL(webhookUrl).hostname, delivered: response.ok },
      });

      return { success: response.ok, messageLogId: messageLogId || undefined };
    } catch {
      console.error('[NotificationService] Slack delivery failed');
      return { success: false, error: 'Delivery failed' };
    }
  }

  /**
   * Send a generic webhook payload and log it to the MessageLog.
   * Works with Discord, Rocket.chat, or any JSON webhook endpoint.
   */
  static async triggerWebhook(
    webhookUrl: string,
    payload: Record<string, unknown>,
    opts?: { agentId?: string; channel?: string; subject?: string },
  ): Promise<NotificationResult> {
    if (!isValidWebhookUrl(webhookUrl)) {
      return { success: false, error: 'Invalid or restricted URL' };
    }

    const fromId = opts?.agentId || 'system';

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const messageLogId = await logToMessageBus({
        fromId,
        toId: `external:webhook`,
        channel: opts?.channel || 'escalation',
        subject: opts?.subject || 'Webhook notification',
        body: JSON.stringify(payload),
        metadata: { webhookHost: new URL(webhookUrl).hostname, delivered: response.ok },
      });

      return { success: response.ok, messageLogId: messageLogId || undefined };
    } catch {
      console.error('[NotificationService] Webhook delivery failed');
      return { success: false, error: 'Delivery failed' };
    }
  }
}
