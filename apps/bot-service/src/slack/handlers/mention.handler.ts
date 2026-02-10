import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { SlackService } from '../slack.service';
import { ExecutorService } from '../../executor/executor.service';
import { QueueService } from '../../executor/queue.service';
import {
  buildExecutionStoppedMessage,
  buildThreadStatusMessage,
} from '../formatters/execution-message.formatter';

@Injectable()
export class MentionHandler implements OnModuleInit {
  private readonly logger = new Logger(MentionHandler.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly executorService: ExecutorService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit(): void {
    const app = this.slackService.getApp();

    app.event('app_mention', async ({ event }) => {
      await this.handleMention(event);
    });

    this.logger.log('app_mention event listener registered');
  }

  async handleMention(event: any): Promise<void> {
    try {
      // Only process mentions inside a thread
      const threadTs = event.thread_ts;
      if (!threadTs) {
        return;
      }

      const userId = event.user;
      if (!this.slackService.isAllowedUser(userId)) {
        return;
      }

      const channel = event.channel;
      const text = this.stripMention(event.text || '').trim();

      if (!text) {
        return;
      }

      const command = text.toLowerCase();

      if (command === 'stop') {
        await this.handleStop(threadTs, channel);
      } else if (command === 'status') {
        await this.handleStatus(threadTs, channel);
      } else {
        await this.handleNewContext(text, userId, threadTs, channel);
      }
    } catch (err) {
      this.logger.error(`app_mention error: ${(err as Error).message}`);
    }
  }

  private async handleStop(threadTs: string, channel: string): Promise<void> {
    const job = await this.executorService.stopJobByThreadTs(threadTs);
    if (job) {
      const msg = buildExecutionStoppedMessage(job, channel);
      await this.slackService.postMessage({
        ...msg,
        thread_ts: threadTs,
      });
      this.logger.log(`Job stopped via thread: ${job.id.slice(0, 8)}`);
    } else {
      await this.slackService.postMessage({
        channel,
        text: ':information_source: 이 쓰레드에 실행 중인 작업이 없습니다.',
        thread_ts: threadTs,
      });
    }
  }

  private async handleStatus(threadTs: string, channel: string): Promise<void> {
    const job = await this.queueService.findJobByThreadTs(threadTs);
    if (job) {
      const msg = buildThreadStatusMessage(job, channel);
      await this.slackService.postMessage({
        ...msg,
        thread_ts: threadTs,
      });
    } else {
      await this.slackService.postMessage({
        channel,
        text: ':information_source: 이 쓰레드에 연결된 작업이 없습니다.',
        thread_ts: threadTs,
      });
    }
  }

  private async handleNewContext(
    prompt: string,
    userId: string,
    threadTs: string,
    channel: string,
  ): Promise<void> {
    const validation = this.executorService.validatePrompt(prompt);
    if (!validation.valid) {
      await this.slackService.postMessage({
        channel,
        text: `:warning: 실행 불가: ${validation.reason}`,
        thread_ts: threadTs,
      });
      return;
    }

    const confirmCmd = this.executorService.needsConfirmation(prompt);
    if (confirmCmd) {
      await this.slackService.postMessage({
        channel,
        text: `:warning: 주의가 필요한 명령이 포함되어 있습니다: \`${confirmCmd}\`\n\`/claude\` 명령으로 다시 실행하세요.`,
        thread_ts: threadTs,
      });
      return;
    }

    const job = await this.executorService.submitJob(prompt, userId, {
      thread_ts: threadTs,
      channel,
    });

    await this.slackService.postMessage({
      channel,
      text: `:white_check_mark: 새 작업이 시작됩니다. (ID: \`${job.id.slice(0, 8)}\`)`,
      thread_ts: threadTs,
    });
    this.logger.log(`New job from thread mention: ${job.id.slice(0, 8)}`);
  }

  private stripMention(text: string): string {
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
  }
}
