import { SessionMeta } from '@app/shared/types/session.types';
import { QuestionFile } from '@app/shared/types/question.types';

export function buildQuestionMessage(
  meta: SessionMeta,
  question: QuestionFile,
  channelId: string,
): { channel: string; thread_ts: string | undefined; text: string; blocks: any[] } {
  const shortSession = meta.sessionId.slice(0, 8);
  const text = `❓ [${shortSession}] ${question.question}`;

  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❓ *질문*\n\n${question.question}`,
      },
    },
  ];

  if (question.context) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${question.context}`,
      },
    });
  }

  if (question.options && question.options.length > 0) {
    const optionText = question.options
      .map((opt, i) => `${i + 1}. ${opt}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*선택지:*\n${optionText}`,
      },
    });
  }

  const actionId = (action: string) =>
    `${action}:${meta.sessionId}:${question.questionId}`;

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ 승인', emoji: true },
        action_id: actionId('approve'),
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '❌ 거절', emoji: true },
        action_id: actionId('reject'),
        style: 'danger',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '💬 답변 입력', emoji: true },
        action_id: actionId('custom_reply'),
      },
    ],
  });

  return {
    channel: channelId,
    thread_ts: meta.slackThreadTs,
    text,
    blocks,
  };
}
