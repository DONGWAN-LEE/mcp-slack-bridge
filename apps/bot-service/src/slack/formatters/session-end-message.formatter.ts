import { SessionMeta } from '@app/shared/types/session.types';
import { TERMINAL_ICONS } from '@app/shared/constants/terminal-icons';

export function buildSessionEndMessage(
  meta: SessionMeta,
  channelId: string,
): { channel: string; thread_ts: string | undefined; text: string; blocks: any[] } {
  const icon = TERMINAL_ICONS[meta.environment.terminal] || TERMINAL_ICONS.unknown;
  const shortId = meta.sessionId.slice(0, 8);
  const endTime = new Date().toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const text = `:red_circle: 세션이 종료되었습니다 (${shortId}...)`;

  return {
    channel: channelId,
    thread_ts: meta.slackThreadTs,
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:red_circle: *세션이 종료되었습니다*`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${icon} ${meta.environment.displayName} | 세션: \`${shortId}...\` | 종료: ${endTime}`,
          },
        ],
      },
    ],
  };
}
