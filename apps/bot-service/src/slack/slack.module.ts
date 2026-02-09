import { Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { ActionHandler } from './handlers/action.handler';
import { ModalHandler } from './handlers/modal.handler';

@Module({
  providers: [SlackService, ModalHandler, ActionHandler],
  exports: [SlackService],
})
export class SlackModule {}
