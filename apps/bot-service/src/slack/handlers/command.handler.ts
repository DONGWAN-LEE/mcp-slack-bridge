import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { join } from 'path';
import { readdirSync } from 'fs';
import { SlackService } from '../slack.service';
import { ExecutorService } from '../../executor/executor.service';
import { QueueService } from '../../executor/queue.service';
import { pathsConfig } from '@app/shared/config/configuration';
import { readJsonFile, atomicWriteJson } from '@app/shared/utils/file.utils';
import { isSafePathSegment } from '@app/shared/utils/action-parser.utils';
import { SessionMeta } from '@app/shared/types/session.types';
import { ContextInjection } from '@app/shared/types/slack.types';
import { ExecutionMode } from '@app/shared/types/executor.types';
import { ConfigType } from '@nestjs/config';
import { buildSessionsListMessage } from '../formatters/sessions-list.formatter';
import {
  buildQueueStatusMessage,
} from '../formatters/execution-message.formatter';

@Injectable()
export class CommandHandler implements OnModuleInit {
  private readonly logger = new Logger(CommandHandler.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly executorService: ExecutorService,
    private readonly queueService: QueueService,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  onModuleInit(): void {
    const app = this.slackService.getApp();

    app.command('/claude', async ({ command, ack, respond }) => {
      await ack();
      await this.handleClaude(command, respond);
    });

    app.command('/claude-sessions', async ({ command, ack, respond }) => {
      await ack();
      await this.handleSessions(command, respond);
    });

    app.command('/claude-inject', async ({ command, ack, respond }) => {
      await ack();
      await this.handleInject(command, respond);
    });

    app.command('/claude-status', async ({ command, ack, respond }) => {
      await ack();
      await this.handleStatus(command, respond);
    });

    app.command('/claude-cancel', async ({ command, ack, respond }) => {
      await ack();
      await this.handleCancel(command, respond);
    });

    this.logger.log('Slash commands registered: /claude, /claude-sessions, /claude-inject, /claude-status, /claude-cancel');
  }

  static readonly MODES: ExecutionMode[] = ['plan', 'brainstorm', 'analyze', 'review'];

  static readonly MODE_LABELS: Record<ExecutionMode, string> = {
    default: '',
    plan: 'Plan Mode',
    brainstorm: 'Brainstorm Mode',
    analyze: 'Analyze Mode',
    review: 'Review Mode',
  };

  static parseMode(text: string): { mode: ExecutionMode; prompt: string } {
    const trimmed = text.trim();
    const [firstWord, ...rest] = trimmed.split(/\s+/);
    const lower = firstWord?.toLowerCase();

    if (CommandHandler.MODES.includes(lower as ExecutionMode)) {
      return {
        mode: lower as ExecutionMode,
        prompt: rest.join(' '),
      };
    }

    return { mode: 'default', prompt: trimmed };
  }

  private async handleClaude(command: any, respond: any): Promise<void> {
    try {
      const userId = command.user_id;
      if (!this.slackService.isAllowedUser(userId)) {
        await respond({ text: ':no_entry: 권한이 없습니다.', response_type: 'ephemeral' });
        return;
      }

      const rawText = command.text?.trim();
      if (!rawText) {
        await respond({
          text: ':information_source: 사용법: `/claude [모드] <프롬프트>`\n모드: `plan`, `brainstorm`, `analyze`, `review` (선택)\n예: `/claude plan 아키텍처를 설계해줘`\n예: `/claude user 테이블에 email 컬럼 추가해줘`',
          response_type: 'ephemeral',
        });
        return;
      }

      const { mode, prompt } = CommandHandler.parseMode(rawText);

      if (!prompt) {
        await respond({
          text: ':warning: 프롬프트를 입력하세요.\n예: `/claude plan 아키텍처를 설계해줘`',
          response_type: 'ephemeral',
        });
        return;
      }

      const validation = this.executorService.validatePrompt(prompt);
      if (!validation.valid) {
        await respond({
          text: `:warning: 실행 불가: ${validation.reason}`,
          response_type: 'ephemeral',
        });
        return;
      }

      const confirmCmd = this.executorService.needsConfirmation(prompt);
      if (confirmCmd) {
        await respond({
          text: `:warning: 주의가 필요한 명령이 포함되어 있습니다: \`${confirmCmd}\`\n확인 후 다시 실행하세요.`,
          response_type: 'ephemeral',
        });
        return;
      }

      const channelId = command.channel_id || this.slackService.getChannelId();
      const job = await this.executorService.submitJob(prompt, userId, {
        channel: channelId,
        mode,
      });

      const modeLabel = mode !== 'default' ? ` [${CommandHandler.MODE_LABELS[mode]}]` : '';
      await respond({
        text: `:white_check_mark:${modeLabel} 작업이 큐에 추가되었습니다. (ID: \`${job.id.slice(0, 8)}\`)`,
        response_type: 'ephemeral',
      });
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`/claude error: ${msg}`);
      await respond({
        text: `:x: 오류: ${msg}`,
        response_type: 'ephemeral',
      });
    }
  }

  private async handleSessions(_command: any, respond: any): Promise<void> {
    try {
      const userId = _command.user_id;
      if (!this.slackService.isAllowedUser(userId)) {
        await respond({ text: ':no_entry: 권한이 없습니다.', response_type: 'ephemeral' });
        return;
      }

      const sessions = this.getActiveSessions();
      const channelId = this.slackService.getChannelId();
      const msg = buildSessionsListMessage(sessions, channelId);

      await respond({
        text: msg.text,
        blocks: msg.blocks,
        response_type: 'in_channel',
      });
    } catch (err) {
      this.logger.error(`/claude-sessions error: ${(err as Error).message}`);
      await respond({
        text: ':x: 세션 목록 조회 실패',
        response_type: 'ephemeral',
      });
    }
  }

  private async handleInject(command: any, respond: any): Promise<void> {
    try {
      const userId = command.user_id;
      if (!this.slackService.isAllowedUser(userId)) {
        await respond({ text: ':no_entry: 권한이 없습니다.', response_type: 'ephemeral' });
        return;
      }

      const text = command.text?.trim() || '';
      const spaceIdx = text.indexOf(' ');
      if (spaceIdx === -1) {
        await respond({
          text: ':information_source: 사용법: `/claude-inject <세션ID접두사> <메시지>`\n예: `/claude-inject a1b2 이 기능은 OAuth2를 사용해야 합니다`',
          response_type: 'ephemeral',
        });
        return;
      }

      const prefix = text.slice(0, spaceIdx);
      const message = text.slice(spaceIdx + 1).trim();

      if (!message) {
        await respond({
          text: ':warning: 주입할 메시지를 입력하세요.',
          response_type: 'ephemeral',
        });
        return;
      }

      const session = this.findSessionByPrefix(prefix);
      if (!session) {
        await respond({
          text: `:warning: 세션 ID 접두사 \`${prefix}\`에 해당하는 활성 세션이 없거나, 여러 세션이 매칭됩니다.`,
          response_type: 'ephemeral',
        });
        return;
      }

      const injection: ContextInjection = {
        type: 'context_injection',
        sessionId: session.sessionId,
        message,
        injectedBy: userId,
        injectedAt: new Date().toISOString(),
      };

      const injectPath = join(
        this.pathsCfg.stateDir,
        'sessions',
        session.sessionId,
        'responses',
        `inject-${Date.now()}.json`,
      );

      atomicWriteJson(injectPath, injection);

      const shortId = session.sessionId.slice(0, 8);
      await respond({
        text: `:syringe: 컨텍스트가 세션 \`${shortId}...\` (${session.environment.displayName})에 주입되었습니다.`,
        response_type: 'in_channel',
      });

      this.logger.log(
        `Context injected: session=${shortId} by=${userId}`,
      );
    } catch (err) {
      this.logger.error(`/claude-inject error: ${(err as Error).message}`);
      await respond({
        text: ':x: 컨텍스트 주입 실패',
        response_type: 'ephemeral',
      });
    }
  }

  private async handleStatus(_command: any, respond: any): Promise<void> {
    try {
      const userId = _command.user_id;
      if (!this.slackService.isAllowedUser(userId)) {
        await respond({ text: ':no_entry: 권한이 없습니다.', response_type: 'ephemeral' });
        return;
      }

      const running = await this.queueService.getRunningJobs();
      const queued = await this.queueService.getQueuedJobs();
      const channelId = this.slackService.getChannelId();
      const msg = buildQueueStatusMessage(running, queued, channelId);

      await respond({
        text: msg.text,
        blocks: msg.blocks,
        response_type: 'ephemeral',
      });
    } catch (err) {
      this.logger.error(`/claude-status error: ${(err as Error).message}`);
      await respond({
        text: ':x: 상태 조회 실패',
        response_type: 'ephemeral',
      });
    }
  }

  private async handleCancel(command: any, respond: any): Promise<void> {
    try {
      const userId = command.user_id;
      if (!this.slackService.isAllowedUser(userId)) {
        await respond({ text: ':no_entry: 권한이 없습니다.', response_type: 'ephemeral' });
        return;
      }

      const jobIdPrefix = command.text?.trim();
      if (!jobIdPrefix) {
        // Cancel the most recent running job
        const running = await this.queueService.getRunningJobs();
        if (running.length === 0) {
          await respond({
            text: ':information_source: 실행 중인 작업이 없습니다.',
            response_type: 'ephemeral',
          });
          return;
        }

        const latest = running[running.length - 1];
        const cancelled = await this.executorService.cancelJobById(latest.id.slice(0, 8));
        if (cancelled) {
          await respond({
            text: `:white_check_mark: 작업 \`${cancelled.id.slice(0, 8)}\`이(가) 취소되었습니다.`,
            response_type: 'in_channel',
          });
        } else {
          await respond({
            text: ':warning: 작업 취소에 실패했습니다.',
            response_type: 'ephemeral',
          });
        }
        return;
      }

      const cancelled = await this.executorService.cancelJobById(jobIdPrefix);
      if (cancelled) {
        await respond({
          text: `:white_check_mark: 작업 \`${cancelled.id.slice(0, 8)}\`이(가) 취소되었습니다.`,
          response_type: 'in_channel',
        });
      } else {
        await respond({
          text: `:warning: ID 접두사 \`${jobIdPrefix}\`에 해당하는 실행 중인 작업을 찾을 수 없습니다.`,
          response_type: 'ephemeral',
        });
      }
    } catch (err) {
      this.logger.error(`/claude-cancel error: ${(err as Error).message}`);
      await respond({
        text: ':x: 작업 취소 실패',
        response_type: 'ephemeral',
      });
    }
  }

  private getActiveSessions(): SessionMeta[] {
    const sessionsDir = join(this.pathsCfg.stateDir, 'sessions');
    const sessionIds = this.listDirectories(sessionsDir).filter(
      (id) => isSafePathSegment(id),
    );
    const sessions: SessionMeta[] = [];

    for (const id of sessionIds) {
      const metaPath = join(sessionsDir, id, 'meta.json');
      const meta = readJsonFile<SessionMeta>(metaPath);
      if (meta && meta.status !== 'terminated') {
        sessions.push(meta);
      }
    }

    sessions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return sessions;
  }

  private findSessionByPrefix(prefix: string): SessionMeta | null {
    if (!isSafePathSegment(prefix)) return null;

    const sessionsDir = join(this.pathsCfg.stateDir, 'sessions');
    const sessionIds = this.listDirectories(sessionsDir).filter(
      (id) => isSafePathSegment(id),
    );
    const matches = sessionIds.filter((id) => id.startsWith(prefix));

    if (matches.length !== 1) return null;

    const metaPath = join(sessionsDir, matches[0], 'meta.json');
    const meta = readJsonFile<SessionMeta>(metaPath);
    if (!meta || meta.status === 'terminated') return null;

    return meta;
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
}
