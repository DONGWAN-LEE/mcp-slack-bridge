import { SessionMeta } from '@app/shared/types/session.types';
import { TERMINAL_ICONS } from '@app/shared/constants/terminal-icons';

export function buildSessionStartMessage(
  meta: SessionMeta,
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  const icon = TERMINAL_ICONS[meta.environment.terminal] || TERMINAL_ICONS.unknown;
  const shortId = meta.sessionId.slice(0, 8);
  const startTime = new Date(meta.createdAt).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const text = `${icon} 새 Claude Code 세션 (${meta.projectName})`;

  const fields = [
    { type: 'mrkdwn', text: `*환경*\n${meta.environment.displayName}` },
    { type: 'mrkdwn', text: `*프로젝트*\n${meta.projectName}` },
  ];

  if (meta.gitBranch) {
    fields.push({ type: 'mrkdwn', text: `*브랜치*\n\`${meta.gitBranch}\`` });
  }

  fields.push({ type: 'mrkdwn', text: `*세션 ID*\n\`${shortId}...\`` });

  return {
    channel: channelId,
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} 새 Claude Code 세션`, emoji: true },
      },
      { type: 'section', fields },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `시작: ${startTime} | 프로젝트: ${meta.projectPath}` },
        ],
      },
    ],
  };
}
