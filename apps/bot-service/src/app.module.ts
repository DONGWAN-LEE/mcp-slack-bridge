import { Module } from '@nestjs/common';
import { SharedModule } from '@app/shared';
import { SlackModule } from './slack/slack.module';
import { PollerModule } from './poller/poller.module';

@Module({
  imports: [SharedModule, SlackModule, PollerModule],
})
export class AppModule {}
