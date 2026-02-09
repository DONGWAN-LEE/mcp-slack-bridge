import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { PollerService } from './poller.service';

@Module({
  imports: [SlackModule],
  providers: [PollerService],
})
export class PollerModule {}
