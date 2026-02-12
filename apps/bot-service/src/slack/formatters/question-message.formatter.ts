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

  const actionId = (action: string) =>
    `${action}:${meta.sessionId}:${question.questionId}`;

  if (question.options && question.options.length > 0) {
    // Show options as text list
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

    // Add individual option buttons (max 24 to reserve 1 slot for custom_reply)
    const MAX_OPTION_BUTTONS = 24;
    const optionButtons = question.options.slice(0, MAX_OPTION_BUTTONS).map((opt, i) => ({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: truncateLabel(opt), emoji: true },
      action_id: actionId(`option_${i}`),
    }));

    blocks.push({
      type: 'actions',
      elements: [
        ...optionButtons,
        {
          type: 'button',
          text: { type: 'plain_text', text: '💬 직접 입력', emoji: true },
          action_id: actionId('custom_reply'),
        },
      ],
    });
  } else {
    // No options: show default approve/reject/custom_reply buttons
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
  }

  return {
    channel: channelId,
    thread_ts: meta.slackThreadTs,
    text,
    blocks,
  };
}

/** Slack button text max is 75 chars */
function truncateLabel(label: string): string {
  return label.length > 72 ? label.slice(0, 69) + '...' : label;
}
