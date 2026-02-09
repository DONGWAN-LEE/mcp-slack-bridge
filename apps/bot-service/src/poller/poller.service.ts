import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import { SlackService } from '../slack/slack.service';
import {
  pathsConfig,
  pollingConfig,
  sessionConfig,
} from '@app/shared/config/configuration';
import { readJsonFile, atomicWriteJson } from '@app/shared/utils/file.utils';
import { SessionMeta } from '@app/shared/types/session.types';
import { QuestionFile } from '@app/shared/types/question.types';
import { NotificationFile } from '@app/shared/types/notification.types';
import { ConfigType } from '@nestjs/config';
import { buildSessionStartMessage } from '../slack/formatters/session-message.formatter';
import { buildQuestionMessage } from '../slack/formatters/question-message.formatter';
import { buildNotificationMessage } from '../slack/formatters/notification-message.formatter';

@Injectable()
export class PollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly knownQuestions = new Map<string, Set<string>>(); // sessionId → questionIds
  private readonly knownNotifications = new Map<string, Set<string>>(); // sessionId → notificationIds
  private polling = false;

  constructor(
    private readonly slackService: SlackService,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
    @Inject(pollingConfig.KEY)
    private readonly pollingCfg: ConfigType<typeof pollingConfig>,
    @Inject(sessionConfig.KEY)
    private readonly sessionCfg: ConfigType<typeof sessionConfig>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.poll(), this.pollingCfg.intervalMs);
    this.logger.log(`Polling started (interval: ${this.pollingCfg.intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Polling stopped');
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const sessionsDir = join(this.pathsCfg.stateDir, 'sessions');
      const sessionIds = this.listDirectories(sessionsDir);

      for (const sessionId of sessionIds) {
        const sessionDir = join(sessionsDir, sessionId);
        const metaPath = join(sessionDir, 'meta.json');
        const meta = readJsonFile<SessionMeta>(metaPath);
        if (!meta || meta.status === 'terminated') continue;

        await this.processQuestions(sessionId, sessionDir, meta, metaPath);
        await this.processNotifications(sessionId, sessionDir, meta);
      }

      await this.cleanStaleSessions(sessionsDir);
    } catch (err) {
      this.logger.error(`Poll error: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private async processQuestions(
    sessionId: string,
    sessionDir: string,
    meta: SessionMeta,
    metaPath: string,
  ): Promise<void> {
    const questionsDir = join(sessionDir, 'questions');
    const files = this.listJsonFiles(questionsDir);

    for (const file of files) {
      const questionPath = join(questionsDir, file);
      const question = readJsonFile<QuestionFile>(questionPath);
      if (!question) continue;

      const sessionKnown = this.knownQuestions.get(sessionId) ?? new Set();
      if (
        question.status !== 'pending' ||
        question.slackMessageTs ||
        sessionKnown.has(question.questionId)
      ) {
        continue;
      }

      sessionKnown.add(question.questionId);
      this.knownQuestions.set(sessionId, sessionKnown);
      await this.handleNewQuestion(sessionId, sessionDir, meta, metaPath, question, questionPath);
    }
  }

  private async handleNewQuestion(
    sessionId: string,
    sessionDir: string,
    meta: SessionMeta,
    metaPath: string,
    question: QuestionFile,
    questionPath: string,
  ): Promise<void> {
    await this.ensureSessionThread(sessionId, meta, metaPath);

    const channelId = this.slackService.getChannelId();
    const freshMeta = readJsonFile<SessionMeta>(metaPath) || meta;
    const msg = buildQuestionMessage(freshMeta, question, channelId);

    const result = await this.slackService.postMessage(msg);

    if (result.ts) {
      question.slackMessageTs = result.ts;
      atomicWriteJson(questionPath, question);
    }

    this.logger.log(
      `Question sent: session=${sessionId.slice(0, 8)} question=${question.questionId}`,
    );
  }

  private async processNotifications(
    sessionId: string,
    sessionDir: string,
    meta: SessionMeta,
  ): Promise<void> {
    const notificationsDir = join(sessionDir, 'notifications');
    const files = this.listJsonFiles(notificationsDir);

    for (const file of files) {
      const notifPath = join(notificationsDir, file);
      const notification = readJsonFile<NotificationFile>(notifPath);
      if (!notification) continue;

      const sessionKnown = this.knownNotifications.get(sessionId) ?? new Set();
      if (
        notification.slackMessageTs ||
        sessionKnown.has(notification.notificationId)
      ) {
        continue;
      }

      sessionKnown.add(notification.notificationId);
      this.knownNotifications.set(sessionId, sessionKnown);

      const channelId = this.slackService.getChannelId();
      const msg = buildNotificationMessage(meta, notification, channelId);

      const result = await this.slackService.postMessage(msg);

      if (result.ts) {
        notification.slackMessageTs = result.ts;
        atomicWriteJson(notifPath, notification);
      }

      this.logger.log(
        `Notification sent: session=${sessionId.slice(0, 8)} level=${notification.level}`,
      );
    }
  }

  private async ensureSessionThread(
    sessionId: string,
    meta: SessionMeta,
    metaPath: string,
  ): Promise<void> {
    if (meta.slackThreadTs) return;

    const channelId = this.slackService.getChannelId();
    const msg = buildSessionStartMessage(meta, channelId);
    const result = await this.slackService.postMessage(msg);

    if (result.ts) {
      meta.slackThreadTs = result.ts;
      atomicWriteJson(metaPath, meta);
      this.logger.log(
        `Session thread created: session=${sessionId.slice(0, 8)} ts=${result.ts}`,
      );
    }
  }

  private async cleanStaleSessions(sessionsDir: string): Promise<void> {
    const sessionIds = this.listDirectories(sessionsDir);

    for (const sessionId of sessionIds) {
      const sessionDir = join(sessionsDir, sessionId);
      const metaPath = join(sessionDir, 'meta.json');
      const meta = readJsonFile<SessionMeta>(metaPath);
      if (!meta || meta.status === 'terminated') continue;

      let isStale = false;
      const heartbeatPath = join(sessionDir, 'heartbeat');
      try {
        const stat = statSync(heartbeatPath);
        isStale = Date.now() - stat.mtimeMs > this.sessionCfg.staleMs;
      } catch {
        const createdMs = new Date(meta.createdAt).getTime();
        isStale = Date.now() - createdMs > this.sessionCfg.staleMs;
      }

      if (isStale) {
        meta.status = 'terminated';
        atomicWriteJson(metaPath, meta);
        this.knownQuestions.delete(sessionId);
        this.knownNotifications.delete(sessionId);
        this.logger.log(`Stale session terminated: ${sessionId.slice(0, 8)}`);
      }
    }
  }

  private listDirectories(dirPath: string): string[] {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  private listJsonFiles(dirPath: string): string[] {
    try {
      return readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }
}
