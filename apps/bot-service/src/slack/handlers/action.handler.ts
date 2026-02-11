import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { join } from 'path';
import { SlackService } from '../slack.service';
import { ModalHandler } from './modal.handler';
import { pathsConfig } from '@app/shared/config/configuration';
import { parseActionId } from '@app/shared/utils/action-parser.utils';
import { atomicWriteJson, readJsonFile } from '@app/shared/utils/file.utils';
import { ResponseFile, QuestionFile } from '@app/shared/types/question.types';
import { ConfigType } from '@nestjs/config';
import { buildResponseUpdateBlocks } from '../formatters/response-message.formatter';

@Injectable()
export class ActionHandler implements OnModuleInit {
  private readonly logger = new Logger(ActionHandler.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly modalHandler: ModalHandler,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  onModuleInit(): void {
    const app = this.slackService.getApp();

    app.action(/^(approve|reject|custom_reply):/, async ({ action, ack, body }) => {
      await ack();

      try {
        const btnAction = action as any;
        const parsed = parseActionId(btnAction.action_id);
        if (!parsed) {
          this.logger.warn(`Invalid action_id: ${btnAction.action_id}`);
          return;
        }

        const userId = body.user.id;
        if (!this.slackService.isAllowedUser(userId)) {
          this.logger.warn(`Unauthorized user: ${userId}`);
          return;
        }

        const channelId = (body as any).channel?.id;
        if (channelId && !this.slackService.isAllowedChannel(channelId)) {
          this.logger.warn(`Unauthorized channel: ${channelId}`);
          return;
        }

        const { action: actionType, sessionId, questionId } = parsed;
        const messageTs = (body as any).message?.ts;

        if (actionType === 'custom_reply') {
          const question = this.readQuestion(sessionId, questionId);
          const originalQuestion = question?.question || '';

          await this.slackService.openView(
            (body as any).trigger_id,
            this.modalHandler.buildReplyModal(
              sessionId,
              questionId,
              originalQuestion,
              channelId,
              messageTs,
            ),
          );
          return;
        }

        const answer = actionType === 'approve' ? 'approved' : 'rejected';
        this.writeResponse(sessionId, questionId, answer, userId);

        if (channelId && messageTs) {
          const update = buildResponseUpdateBlocks(answer, userId);
          await this.slackService.updateMessage({
            channel: channelId,
            ts: messageTs,
            text: update.text,
            blocks: update.blocks,
          });
        }

        this.logger.log(
          `Action ${actionType}: session=${sessionId.slice(0, 8)} question=${questionId}`,
        );
      } catch (err) {
        this.logger.error(`Action handler error: ${(err as Error).message}`);
      }
    });
  }

  private writeResponse(
    sessionId: string,
    questionId: string,
    answer: string,
    userId: string,
  ): void {
    const responsePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'responses',
      `${questionId}.json`,
    );

    const response: ResponseFile = {
      questionId,
      answer,
      respondedBy: userId,
      respondedAt: new Date().toISOString(),
      source: 'slack_button',
    };

    atomicWriteJson(responsePath, response);
  }

  private readQuestion(
    sessionId: string,
    questionId: string,
  ): QuestionFile | null {
    const questionPath = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'questions',
      `${questionId}.json`,
    );
    return readJsonFile<QuestionFile>(questionPath);
  }
}
