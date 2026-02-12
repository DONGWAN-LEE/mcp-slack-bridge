import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { join } from 'path';
import { readdirSync, statSync, rmSync } from 'fs';
import { SlackService } from '../slack/slack.service';
import { SessionThreadService } from './session-thread.service';
import {
  pathsConfig,
  pollingConfig,
  sessionConfig,
} from '@app/shared/config/configuration';
import { readJsonFile, atomicWriteJson } from '@app/shared/utils/file.utils';
import { SessionMeta } from '@app/shared/types/session.types';
import { QuestionFile } from '@app/shared/types/question.types';
import { NotificationFile } from '@app/shared/types/notification.types';
import { CommandResultFile } from '@app/shared/types/command.types';
import { ConfigType } from '@nestjs/config';
import { buildSessionStartMessage } from '../slack/formatters/session-message.formatter';
import { buildQuestionMessage } from '../slack/formatters/question-message.formatter';
import { buildNotificationMessage } from '../slack/formatters/notification-message.formatter';
import { buildSessionEndMessage } from '../slack/formatters/session-end-message.formatter';
import { buildCommandResultMessage } from '../slack/formatters/command-message.formatter';
import { buildSessionsListMessage } from '../slack/formatters/sessions-list.formatter';

@Injectable()
export class PollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly knownQuestions = new Map<string, Set<string>>(); // sessionId → questionIds
  private readonly knownNotifications = new Map<string, Set<string>>(); // sessionId → notificationIds
  private readonly knownSessions = new Set<string>();
  private polling = false;

  constructor(
    private readonly slackService: SlackService,
    private readonly sessionThreadService: SessionThreadService,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
    @Inject(pollingConfig.KEY)
    private readonly pollingCfg: ConfigType<typeof pollingConfig>,
    @Inject(sessionConfig.KEY)
    private readonly sessionCfg: ConfigType<typeof sessionConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.announceActiveSessions();
    this.timer = setInterval(() => this.poll(), this.pollingCfg.intervalMs);
    this.logger.log(`Polling started (interval: ${this.pollingCfg.intervalMs}ms)`);
  }

  private async announceActiveSessions(): Promise<void> {
    try {
      const sessionsDir = join(this.pathsCfg.stateDir, 'sessions');
      const sessionIds = this.listDirectories(sessionsDir);
      const activeSessions: SessionMeta[] = [];

      for (const sessionId of sessionIds) {
        const metaPath = join(sessionsDir, sessionId, 'meta.json');
        const meta = readJsonFile<SessionMeta>(metaPath);
        if (!meta || meta.status === 'terminated') continue;

        if (meta.slackThreadTs) {
          delete meta.slackThreadTs;
          atomicWriteJson(metaPath, meta);
        }

        activeSessions.push(meta);
      }

      if (activeSessions.length === 0) {
        this.logger.log('Startup: no active sessions found');
        return;
      }

      activeSessions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const channelId = this.slackService.getChannelId();
      const msg = buildSessionsListMessage(activeSessions, channelId);
      await this.slackService.postMessage(msg);

      this.logger.log(`Startup: ${activeSessions.length} active session(s) announced`);
    } catch (err) {
      this.logger.error(`Startup announcement failed: ${(err as Error).message}`);
    }
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

        // Proactive session thread creation
        await this.ensureProactiveSessionThread(sessionId, meta, metaPath);

        await this.processQuestions(sessionId, sessionDir, meta, metaPath);
        await this.processNotifications(sessionId, sessionDir, meta);
        await this.processCommandResults(sessionId, sessionDir, meta);
      }

      await this.cleanStaleSessions(sessionsDir);
      this.cleanTerminatedSessions(sessionsDir);
    } catch (err) {
      this.logger.error(`Poll error: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private async ensureProactiveSessionThread(
    sessionId: string,
    meta: SessionMeta,
    metaPath: string,
  ): Promise<void> {
    if (this.knownSessions.has(sessionId)) {
      return;
    }

    // New session discovered
    this.knownSessions.add(sessionId);
    this.logger.log(`New session discovered: ${sessionId.slice(0, 8)}`);

    await this.ensureSessionThread(sessionId, meta, metaPath);
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

      // Wait for notification delay before sending to Slack
      const delaySec = this.pollingCfg.notificationDelaySec;
      if (delaySec > 0) {
        const createdMs = new Date(question.createdAt).getTime();
        const elapsedMs = Date.now() - createdMs;
        if (elapsedMs < delaySec * 1000) {
          continue; // Not yet time to notify; will be picked up in a future poll
        }
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

  private async processCommandResults(
    sessionId: string,
    sessionDir: string,
    meta: SessionMeta,
  ): Promise<void> {
    const resultsDir = join(sessionDir, 'command-results');
    const files = this.listJsonFiles(resultsDir);

    for (const file of files) {
      const resultPath = join(resultsDir, file);
      const cmdResult = readJsonFile<CommandResultFile>(resultPath);
      if (!cmdResult || cmdResult.posted) continue;

      try {
        const channelId = this.slackService.getChannelId();
        const msg = buildCommandResultMessage(meta, cmdResult, channelId);

        const postResult = await this.slackService.postMessage(msg);

        if (postResult.ts) {
          cmdResult.posted = true;
          atomicWriteJson(resultPath, cmdResult);
        }

        this.logger.log(
          `Command result posted: session=${sessionId.slice(0, 8)} cmd=${cmdResult.commandId}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to post command result: session=${sessionId.slice(0, 8)} cmd=${cmdResult.commandId} error=${(err as Error).message}`,
        );
      }
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
      this.sessionThreadService.registerThread(result.ts, sessionId);
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
      } catch (err) {
        this.logger.debug(`Heartbeat file not found for session ${sessionId.slice(0, 8)}: ${(err as Error).message}`);
        const createdMs = new Date(meta.createdAt).getTime();
        isStale = Date.now() - createdMs > this.sessionCfg.staleMs;
      }

      if (isStale) {
        // Post session end message if thread exists
        if (meta.slackThreadTs) {
          try {
            const channelId = this.slackService.getChannelId();
            const msg = buildSessionEndMessage(meta, channelId);
            await this.slackService.postMessage(msg);
          } catch (err) {
            this.logger.error(
              `Failed to post session end: ${(err as Error).message}`,
            );
          }
        }

        meta.status = 'terminated';
        atomicWriteJson(metaPath, meta);
        this.knownQuestions.delete(sessionId);
        this.knownNotifications.delete(sessionId);
        this.knownSessions.delete(sessionId);
        this.sessionThreadService.unregisterSession(sessionId);
        this.logger.warn(`Stale session terminated: ${sessionId.slice(0, 8)}`);
      }
    }
  }

  private cleanTerminatedSessions(sessionsDir: string): void {
    const sessionIds = this.listDirectories(sessionsDir);

    for (const sessionId of sessionIds) {
      const sessionDir = join(sessionsDir, sessionId);
      const metaPath = join(sessionDir, 'meta.json');
      const meta = readJsonFile<SessionMeta>(metaPath);
      if (!meta || meta.status !== 'terminated') continue;

      const lastActiveMs = new Date(meta.lastActiveAt || meta.createdAt).getTime();
      if (Date.now() - lastActiveMs > 3600000) { // 1 hour
        try {
          rmSync(sessionDir, { recursive: true, force: true });
          this.logger.log(`Terminated session directory removed: ${sessionId.slice(0, 8)}`);
        } catch (err) {
          this.logger.error(`Failed to remove session directory ${sessionId.slice(0, 8)}: ${(err as Error).message}`);
        }
      }
    }
  }

  private listDirectories(dirPath: string): string[] {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      this.logger.debug(`Directory not found: ${dirPath} (${(err as Error).message})`);
      return [];
    }
  }

  private listJsonFiles(dirPath: string): string[] {
    try {
      return readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    } catch (err) {
      this.logger.debug(`Directory not found: ${dirPath} (${(err as Error).message})`);
      return [];
    }
  }
}
