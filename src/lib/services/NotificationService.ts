import axios from 'axios';

/**
 * NotificationService (P5 SaaS Middleman)
 * Centralized service to capture and route agent events to external webhooks (Slack, Discord, Custom).
 */
export class NotificationService {
  /**
   * Sends a notification to a Slack Webhook URL.
   */
  static async sendSlackNotification(webhookUrl: string, message: string, agentId?: string) {
    try {
      const payload = {
        text: `🚀 *Mission Control Update* 🚀\n*Agent:* ${agentId || 'System'}\n*Status:* ${message}`,
        icon_emoji: ':robot_face:',
      };
      await axios.post(webhookUrl, payload);
      return { success: true };
    } catch (error) {
      console.error('[NotificationService] Slack Fail:', error);
      return { success: false, error };
    }
  }

  /**
   * Generic Webhook Dispatcher (For Rocket.chat or Custom Listeners)
   */
  static async triggerWebhook(url: string, data: any) {
    try {
      await axios.post(url, {
        timestamp: new Date().toISOString(),
        ...data
      });
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  }
}
