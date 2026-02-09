import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { join } from 'path';
import { SlackService } from '../slack.service';
import { pathsConfig } from '@app/shared/config/configuration';
import { isSafePathSegment } from '@app/shared/utils/action-parser.utils';
import { atomicWriteJson } from '@app/shared/utils/file.utils';
import { ResponseFile } from '@app/shared/types/question.types';
import { ConfigType } from '@nestjs/config';
import { buildResponseUpdateBlocks } from '../formatters/response-message.formatter';

@Injectable()
export class ModalHandler implements OnModuleInit {
  private readonly logger = new Logger(ModalHandler.name);

  constructor(
    private readonly slackService: SlackService,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  onModuleInit(): void {
    const app = this.slackService.getApp();

    app.view('custom_reply_submit', async ({ ack, view, body }) => {
      await ack();

      try {
        const inputValue =
          view.state.values['reply_block']?.['reply_input']?.value;
        if (!inputValue) return;

        let metadata: {
          sessionId: string;
          questionId: string;
          channelId: string;
          messageTs: string;
        };
        try {
          metadata = JSON.parse(view.private_metadata);
        } catch {
          this.logger.error('Failed to parse modal private_metadata');
          return;
        }

        const { sessionId, questionId, channelId, messageTs } = metadata;
        const userId = body.user.id;

        if (!this.slackService.isAllowedUser(userId)) {
          this.logger.warn(`Unauthorized modal user: ${userId}`);
          return;
        }

        if (!isSafePathSegment(sessionId) || !isSafePathSegment(questionId)) {
          this.logger.warn(`Unsafe path segments in modal metadata: ${sessionId}, ${questionId}`);
          return;
        }

        this.writeResponse(sessionId, questionId, inputValue, userId);

        const update = buildResponseUpdateBlocks(inputValue, userId);
        await this.slackService.updateMessage({
          channel: channelId,
          ts: messageTs,
          text: update.text,
          blocks: update.blocks,
        });

        this.logger.log(
          `Modal reply: session=${sessionId.slice(0, 8)} question=${questionId}`,
        );
      } catch (err) {
        this.logger.error(`Modal handler error: ${(err as Error).message}`);
      }
    });
  }

  buildReplyModal(
    sessionId: string,
    questionId: string,
    originalQuestion: string,
    channelId: string,
    messageTs: string,
  ): any {
    return {
      type: 'modal',
      callback_id: 'custom_reply_submit',
      private_metadata: JSON.stringify({
        sessionId,
        questionId,
        channelId,
        messageTs,
      }),
      title: { type: 'plain_text', text: '답변 입력' },
      submit: { type: 'plain_text', text: '전송' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*원본 질문:*\n${originalQuestion}`,
          },
        },
        {
          type: 'input',
          block_id: 'reply_block',
          element: {
            type: 'plain_text_input',
            action_id: 'reply_input',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: '답변을 입력하세요...',
            },
          },
          label: { type: 'plain_text', text: '답변' },
        },
      ],
    };
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
      source: 'slack_text',
    };

    atomicWriteJson(responsePath, response);
  }
}
