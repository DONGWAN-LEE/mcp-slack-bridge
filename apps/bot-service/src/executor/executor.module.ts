import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { QueueService } from './queue.service';
import { ExecutorService } from './executor.service';
import { CommandHandler } from '../slack/handlers/command.handler';

@Module({
  imports: [SlackModule],
  providers: [QueueService, ExecutorService, CommandHandler],
  exports: [QueueService, ExecutorService],
})
export class ExecutorModule {}
