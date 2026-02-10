import { SessionMeta } from '@app/shared/types/session.types';
import { TERMINAL_ICONS } from '@app/shared/constants/terminal-icons';

const STATUS_ICONS: Record<string, string> = {
  active: '\u{1F7E2}',     // 🟢
  idle: '\u{1F7E1}',       // 🟡
  waiting: '\u{1F7E1}',    // 🟡
  terminated: '\u{1F534}',  // 🔴
};

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  idle: '대기',
  waiting: '질문 대기 중',
  terminated: '종료',
};

export function buildSessionsListMessage(
  sessions: SessionMeta[],
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  if (sessions.length === 0) {
    return {
      channel: channelId,
      text: '활성 세션 없음',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':clipboard: *활성 Claude Code 세션이 없습니다.*',
          },
        },
      ],
    };
  }

  const header = {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `\u{1F4CB} 활성 Claude Code 세션 (${sessions.length}개)`,
      emoji: true,
    },
  };

  const sessionBlocks: any[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const meta = sessions[i];
    const icon =
      TERMINAL_ICONS[meta.environment.terminal] || TERMINAL_ICONS.unknown;
    const statusIcon = STATUS_ICONS[meta.status] || STATUS_ICONS.active;
    const statusLabel = STATUS_LABELS[meta.status] || meta.status;
    const shortId = meta.sessionId.slice(0, 8);
    const startTime = new Date(meta.createdAt).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const branch = meta.gitBranch ? ` \u{2014} ${meta.gitBranch}` : '';

    sessionBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${i + 1}.* ${icon} ${meta.environment.displayName}${branch} \u{2014} \`${shortId}...\`\n\u{23F0} 시작: ${startTime} | 상태: ${statusIcon} ${statusLabel}`,
      },
    });
  }

  const blocks = [header, { type: 'divider' }, ...sessionBlocks];

  return {
    channel: channelId,
    text: `활성 Claude Code 세션 (${sessions.length}개)`,
    blocks,
  };
}
