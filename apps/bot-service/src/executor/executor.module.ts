import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { QueueService } from './queue.service';
import { ExecutorService } from './executor.service';
import { CommandHandler } from '../slack/handlers/command.handler';
import { MentionHandler } from '../slack/handlers/mention.handler';

@Module({
  imports: [SlackModule],
  providers: [QueueService, ExecutorService, CommandHandler, MentionHandler],
  exports: [QueueService, ExecutorService],
})
export class ExecutorModule {}
