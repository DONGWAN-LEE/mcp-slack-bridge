import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { PollerService } from './poller.service';
import { SessionThreadService } from './session-thread.service';

@Module({
  imports: [SlackModule],
  providers: [PollerService, SessionThreadService],
  exports: [SessionThreadService],
})
export class PollerModule {}
