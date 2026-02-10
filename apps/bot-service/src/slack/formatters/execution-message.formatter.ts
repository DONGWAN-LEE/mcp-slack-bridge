import { ExecutionJob, ExecutionMode } from '@app/shared/types/executor.types';

const MODE_BADGES: Record<ExecutionMode, string> = {
  default: '',
  plan: ':clipboard: *[Plan Mode]*',
  brainstorm: ':bulb: *[Brainstorm]*',
  analyze: ':mag: *[Analyze]*',
  review: ':eyes: *[Review]*',
};

const STATUS_LABELS: Record<string, string> = {
  queued: ':hourglass_flowing_sand: 대기 중',
  running: ':arrow_forward: 실행 중',
  completed: ':white_check_mark: 완료',
  failed: ':x: 실패',
  cancelled: ':no_entry_sign: 취소됨',
  stopped: ':stop_button: 중지됨',
};

export function buildExecutionStartMessage(
  job: ExecutionJob,
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  const truncatedPrompt =
    job.prompt.length > 100
      ? job.prompt.slice(0, 100) + '...'
      : job.prompt;

  const modeBadge = job.mode && job.mode !== 'default' ? `${MODE_BADGES[job.mode]} ` : '';

  return {
    channel: channelId,
    text: `Claude 작업 시작: ${truncatedPrompt}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:robot_face: *Claude Code 작업 시작*${modeBadge ? `\n${modeBadge}` : ''}\n:memo: \`${truncatedPrompt}\`\n:bust_in_silhouette: <@${job.requestedBy}>`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `작업 ID: \`${job.id.slice(0, 8)}\`` },
          { type: 'mrkdwn', text: `쓰레드에서 \`@claude stop\`, \`@claude status\` 사용 가능` },
        ],
      },
    ],
  };
}

export function buildExecutionCompleteMessage(
  job: ExecutionJob,
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  const isSuccess = job.result?.exitCode === 0;
  const icon = isSuccess ? ':white_check_mark:' : ':x:';
  const label = isSuccess ? '완료' : '실패';
  const durationSec = job.result
    ? (job.result.durationMs / 1000).toFixed(1)
    : '?';

  const truncatedPrompt =
    job.prompt.length > 80 ? job.prompt.slice(0, 80) + '...' : job.prompt;

  const output = job.result?.stdout || job.error || '(출력 없음)';
  const truncatedOutput =
    output.length > 2000 ? output.slice(0, 2000) + '\n...(잘림)' : output;

  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *Claude Code 작업 ${label}*\n:memo: \`${truncatedPrompt}\`\n:stopwatch: 소요: ${durationSec}초`,
      },
    },
  ];

  if (truncatedOutput && truncatedOutput !== '(출력 없음)') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`\n${truncatedOutput}\n\`\`\``,
      },
    });
  }

  if (job.result?.stderr) {
    const truncatedErr =
      job.result.stderr.length > 500
        ? job.result.stderr.slice(0, 500) + '\n...(잘림)'
        : job.result.stderr;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *stderr:*\n\`\`\`\n${truncatedErr}\n\`\`\``,
      },
    });
  }

  return {
    channel: channelId,
    text: `Claude 작업 ${label}: ${truncatedPrompt}`,
    blocks,
  };
}

export function buildExecutionStoppedMessage(
  job: ExecutionJob,
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  const truncatedPrompt =
    job.prompt.length > 80 ? job.prompt.slice(0, 80) + '...' : job.prompt;

  return {
    channel: channelId,
    text: `작업 중지됨: ${truncatedPrompt}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:stop_button: *작업이 중지되었습니다*\n:memo: \`${truncatedPrompt}\``,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: '새 context를 입력하면 이 쓰레드에서 작업을 재시작합니다.' },
          { type: 'mrkdwn', text: `작업 ID: \`${job.id.slice(0, 8)}\`` },
        ],
      },
    ],
  };
}

export function buildThreadStatusMessage(
  job: ExecutionJob,
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  const truncatedPrompt =
    job.prompt.length > 80 ? job.prompt.slice(0, 80) + '...' : job.prompt;

  const statusLabel = STATUS_LABELS[job.status] || job.status;
  const modeBadge = job.mode && job.mode !== 'default' ? MODE_BADGES[job.mode] : '';

  const details: string[] = [
    `*상태:* ${statusLabel}`,
    `*프롬프트:* \`${truncatedPrompt}\``,
    `*요청자:* <@${job.requestedBy}>`,
  ];

  if (modeBadge) {
    details.push(`*모드:* ${modeBadge}`);
  }

  if (job.result?.durationMs) {
    details.push(`*소요:* ${(job.result.durationMs / 1000).toFixed(1)}초`);
  }

  return {
    channel: channelId,
    text: `작업 상태: ${statusLabel}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:bar_chart: *작업 상태 조회*\n${details.join('\n')}`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `작업 ID: \`${job.id.slice(0, 8)}\`` },
        ],
      },
    ],
  };
}

export function buildQueueStatusMessage(
  running: ExecutionJob[],
  queued: ExecutionJob[],
  channelId: string,
): { channel: string; text: string; blocks: any[] } {
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '\u{1F4CB} 실행 큐 상태',
        emoji: true,
      },
    },
  ];

  if (running.length === 0 && queued.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '실행 중이거나 대기 중인 작업이 없습니다.',
      },
    });
  } else {
    if (running.length > 0) {
      const runningText = running
        .map((j) => {
          const truncated =
            j.prompt.length > 60 ? j.prompt.slice(0, 60) + '...' : j.prompt;
          return `:arrow_forward: \`${truncated}\` (by <@${j.requestedBy}>)`;
        })
        .join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*실행 중 (${running.length}):*\n${runningText}`,
        },
      });
    }

    if (queued.length > 0) {
      const queuedText = queued
        .map((j, i) => {
          const truncated =
            j.prompt.length > 60 ? j.prompt.slice(0, 60) + '...' : j.prompt;
          return `${i + 1}. \`${truncated}\` (by <@${j.requestedBy}>)`;
        })
        .join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*대기 중 (${queued.length}):*\n${queuedText}`,
        },
      });
    }
  }

  return {
    channel: channelId,
    text: `실행 큐: ${running.length}개 실행 중, ${queued.length}개 대기`,
    blocks,
  };
}
