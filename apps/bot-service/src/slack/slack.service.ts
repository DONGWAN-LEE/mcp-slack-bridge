import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { App } from '@slack/bolt';
import { slackConfig, securityConfig } from '@app/shared/config/configuration';
import { ConfigType } from '@nestjs/config';

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app!: App;

  constructor(
    @Inject(slackConfig.KEY)
    private readonly slackCfg: ConfigType<typeof slackConfig>,
    @Inject(securityConfig.KEY)
    private readonly secCfg: ConfigType<typeof securityConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.app = new App({
      token: this.slackCfg.botToken,
      appToken: this.slackCfg.appToken,
      socketMode: true,
      // Disable built-in receiver logging to use NestJS Logger
      logLevel: undefined,
    });

    if (!this.slackCfg.channelId) {
      throw new Error('SLACK_CHANNEL_ID is not configured');
    }

    await this.app.start();
    this.logger.log('Slack Bot started (Socket Mode)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.app.stop();
    this.logger.log('Slack Bot stopped');
  }

  getApp(): App {
    return this.app;
  }

  async postMessage(params: {
    channel: string;
    text: string;
    blocks?: any[];
    thread_ts?: string;
  }): Promise<{ ts?: string }> {
    const result = await this.app.client.chat.postMessage({
      channel: params.channel,
      text: params.text,
      blocks: params.blocks,
      thread_ts: params.thread_ts,
    });
    return { ts: result.ts };
  }

  async updateMessage(params: {
    channel: string;
    ts: string;
    text: string;
    blocks?: any[];
  }): Promise<void> {
    await this.app.client.chat.update({
      channel: params.channel,
      ts: params.ts,
      text: params.text,
      blocks: params.blocks,
    });
  }

  async openView(triggerId: string, view: any): Promise<void> {
    await this.app.client.views.open({
      trigger_id: triggerId,
      view,
    });
  }

  isAllowedUser(userId: string): boolean {
    return this.secCfg.allowedUserIds.includes(userId);
  }

  isAllowedChannel(channelId: string): boolean {
    if (this.secCfg.allowedChannelIds.length === 0) return true;
    return this.secCfg.allowedChannelIds.includes(channelId);
  }

  getChannelId(): string {
    return this.slackCfg.channelId!;
  }
}
