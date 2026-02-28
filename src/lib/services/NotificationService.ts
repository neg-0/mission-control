/**
 * NotificationService (P5 SaaS Middleman - Refined)
 * Uses native fetch and basic URL validation to prevent SSRF.
 */
export class NotificationService {
  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Basic SSRF protection: only allow http/https and block local IPs
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)
      );
    } catch {
      return false;
    }
  }

  static async sendSlackNotification(webhookUrl: string, message: string, agentId?: string) {
    if (!this.isValidUrl(webhookUrl)) {
      return { success: false, error: 'Invalid or restricted URL' };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚀 *Mission Control Update*\n*Agent:* ${agentId || 'System'}\n*Status:* ${message}`,
          icon_emoji: ':robot_face:',
        }),
      });

      return { success: response.ok };
    } catch (e) {
      console.error('[NotificationService] Slack delivery failed');
      return { success: false }; // Don't leak raw error objects
    }
  }
}
