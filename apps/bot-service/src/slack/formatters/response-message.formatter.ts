export function buildResponseUpdateBlocks(
  answer: string,
  userId: string,
): { text: string; blocks: any[] } {
  const displayAnswer = answer === 'approved'
    ? '✅ 승인됨'
    : answer === 'rejected'
      ? '❌ 거절됨'
      : `💬 ${answer}`;

  const text = `응답 완료: ${displayAnswer}`;

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${displayAnswer}\n_응답: <@${userId}>_`,
        },
      },
    ],
  };
}
