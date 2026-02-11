import { Injectable, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { join } from 'path';
import { readdirSync } from 'fs';
import { pathsConfig } from '@app/shared/config/configuration';
import { atomicWriteJson, readJsonFile } from '@app/shared/utils/file.utils';
import { QuestionFile } from '@app/shared/types/question.types';
import { NotificationFile } from '@app/shared/types/notification.types';
import { ResponseFile } from '@app/shared/types/question.types';
import { CommandFile, CommandResultFile } from '@app/shared/types/command.types';

@Injectable()
export class FileBridgeService {
  constructor(
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  writeQuestion(question: QuestionFile): void {
    this.validatePathSegment(question.sessionId);
    this.validatePathSegment(question.questionId);
    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      question.sessionId,
      'questions',
      `${question.questionId}.json`,
    );
    try {
      atomicWriteJson(filePath, question);
    } catch (err) {
      console.error(`[FileBridge] Failed to write question ${question.questionId}: ${(err as Error).message}`);
      throw err;
    }
  }

  readResponse(sessionId: string, questionId: string): ResponseFile | null {
    this.validatePathSegment(sessionId);
    this.validatePathSegment(questionId);
    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'responses',
      `${questionId}.json`,
    );
    return readJsonFile<ResponseFile>(filePath);
  }

  writeNotification(notification: NotificationFile): void {
    this.validatePathSegment(notification.sessionId);
    this.validatePathSegment(notification.notificationId);
    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      notification.sessionId,
      'notifications',
      `${notification.notificationId}.json`,
    );
    try {
      atomicWriteJson(filePath, notification);
    } catch (err) {
      console.error(`[FileBridge] Failed to write notification ${notification.notificationId}: ${(err as Error).message}`);
      throw err;
    }
  }

  updateQuestionStatus(
    sessionId: string,
    questionId: string,
    status: QuestionFile['status'],
  ): void {
    this.validatePathSegment(sessionId);
    this.validatePathSegment(questionId);
    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'questions',
      `${questionId}.json`,
    );
    try {
      const question = readJsonFile<QuestionFile>(filePath);
      if (question) {
        question.status = status;
        atomicWriteJson(filePath, question);
      }
    } catch (err) {
      console.error(`[FileBridge] Failed to update question status ${questionId}: ${(err as Error).message}`);
    }
  }

  readPendingCommands(sessionId: string): CommandFile[] {
    this.validatePathSegment(sessionId);
    const commandsDir = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'commands',
    );
    try {
      const files = readdirSync(commandsDir).filter((f) => f.endsWith('.json'));
      const commands: CommandFile[] = [];
      for (const file of files) {
        const cmd = readJsonFile<CommandFile>(join(commandsDir, file));
        if (cmd && cmd.status === 'pending') {
          commands.push(cmd);
        }
      }
      return commands.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    } catch (err) {
      console.error(`[FileBridge] Failed to read pending commands for session ${sessionId}: ${(err as Error).message}`);
      return [];
    }
  }

  updateCommandStatus(
    sessionId: string,
    commandId: string,
    status: CommandFile['status'],
  ): void {
    this.validatePathSegment(sessionId);
    this.validatePathSegment(commandId);
    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'commands',
      `${commandId}.json`,
    );
    try {
      const cmd = readJsonFile<CommandFile>(filePath);
      if (cmd) {
        cmd.status = status;
        atomicWriteJson(filePath, cmd);
      }
    } catch (err) {
      console.error(`[FileBridge] Failed to update command status ${commandId}: ${(err as Error).message}`);
    }
  }

  writeCommandResult(result: CommandResultFile): void {
    this.validatePathSegment(result.sessionId);
    this.validatePathSegment(result.commandId);
    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      result.sessionId,
      'command-results',
      `${result.commandId}.json`,
    );
    try {
      atomicWriteJson(filePath, result);
    } catch (err) {
      console.error(`[FileBridge] Failed to write command result ${result.commandId}: ${(err as Error).message}`);
      throw err;
    }
  }

  private validatePathSegment(segment: string): void {
    if (!segment || segment.length > 255) {
      throw new Error('Invalid path segment: invalid length');
    }
    if (/[\/\\]|\.\./.test(segment)) {
      throw new Error('Invalid path segment: path traversal detected');
    }
    if (segment.includes('\0') || /[\x00-\x1F\x7F]/.test(segment)) {
      throw new Error('Invalid path segment: control characters detected');
    }
  }
}
