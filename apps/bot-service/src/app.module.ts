import { Module } from '@nestjs/common';
import { SharedModule } from '@app/shared';
import { SlackModule } from './slack/slack.module';
import { PollerModule } from './poller/poller.module';
import { ExecutorModule } from './executor/executor.module';

@Module({
  imports: [SharedModule, SlackModule, PollerModule, ExecutorModule],
})
export class AppModule {}
