import { Injectable, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { join } from 'path';
import { pathsConfig } from '@app/shared/config/configuration';
import { atomicWriteJson, readJsonFile } from '@app/shared/utils/file.utils';
import { QuestionFile } from '@app/shared/types/question.types';
import { NotificationFile } from '@app/shared/types/notification.types';
import { ResponseFile } from '@app/shared/types/question.types';

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
    atomicWriteJson(filePath, question);
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
    atomicWriteJson(filePath, notification);
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
    const question = readJsonFile<QuestionFile>(filePath);
    if (question) {
      question.status = status;
      atomicWriteJson(filePath, question);
    }
  }

  private validatePathSegment(segment: string): void {
    if (/[\/\\]|\.\./.test(segment)) {
      throw new Error(`Invalid path segment: ${segment}`);
    }
  }
}
