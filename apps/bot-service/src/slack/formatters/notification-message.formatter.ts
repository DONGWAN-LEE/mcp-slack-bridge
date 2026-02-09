import { SessionMeta } from '@app/shared/types/session.types';
import { NotificationFile } from '@app/shared/types/notification.types';

const LEVEL_ICONS: Record<string, string> = {
  info: '\u{2139}\u{FE0F}',    // ℹ️
  warning: '\u{26A0}\u{FE0F}', // ⚠️
  error: '\u{1F6A8}',          // 🚨
};

export function buildNotificationMessage(
  meta: SessionMeta,
  notification: NotificationFile,
  channelId: string,
): { channel: string; thread_ts: string | undefined; text: string; blocks: any[] } {
  const icon = LEVEL_ICONS[notification.level] || LEVEL_ICONS.info;
  const shortSession = meta.sessionId.slice(0, 8);
  const text = `${icon} [${shortSession}] ${notification.message}`;

  return {
    channel: channelId,
    thread_ts: meta.slackThreadTs,
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${notification.level.toUpperCase()}*\n\n${notification.message}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `세션: \`${shortSession}...\` | ${new Date(notification.createdAt).toLocaleTimeString('ko-KR')}`,
          },
        ],
      },
    ],
  };
}
