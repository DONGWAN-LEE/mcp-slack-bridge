import { SessionMeta } from '@app/shared/types/session.types';
import { CommandResultFile } from '@app/shared/types/command.types';

// Slack section text block limit is 3000 characters
const MAX_RESULT_LENGTH = 3000;

export function buildCommandResultMessage(
  meta: SessionMeta,
  cmdResult: CommandResultFile,
  channelId: string,
): { channel: string; thread_ts: string | undefined; text: string; blocks: any[] } {
  const shortSession = meta.sessionId.slice(0, 8);
  const statusIcon = cmdResult.status === 'success' ? ':white_check_mark:' : ':x:';

  let resultText = cmdResult.result;
  if (resultText.length > MAX_RESULT_LENGTH) {
    resultText = resultText.slice(0, MAX_RESULT_LENGTH) + '\n... (truncated)';
  }

  const text = `${statusIcon} 명령 실행 결과 (${shortSession}...)`;

  return {
    channel: channelId,
    thread_ts: meta.slackThreadTs,
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusIcon} *명령 실행 결과*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`\n${resultText}\n\`\`\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `세션: \`${shortSession}...\` | 명령: \`${cmdResult.commandId}\` | ${new Date(cmdResult.completedAt).toLocaleTimeString('ko-KR')}`,
          },
        ],
      },
    ],
  };
}
