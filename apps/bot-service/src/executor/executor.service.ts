import {
  Injectable,
  Inject,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import {
  pathsConfig,
  securityConfig,
  queueConfig,
} from '@app/shared/config/configuration';
import { ConfigType } from '@nestjs/config';
import { QueueService } from './queue.service';
import { SlackService } from '../slack/slack.service';
import {
  buildExecutionStartMessage,
  buildExecutionCompleteMessage,
} from '../slack/formatters/execution-message.formatter';
import { ExecutionJob, ExecutionMode, ExecutionResult } from '@app/shared/types/executor.types';
import * as treeKill from 'tree-kill';

@Injectable()
export class ExecutorService implements OnModuleDestroy {
  private readonly logger = new Logger(ExecutorService.name);
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly queueService: QueueService,
    private readonly slackService: SlackService,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
    @Inject(securityConfig.KEY)
    private readonly secCfg: ConfigType<typeof securityConfig>,
    @Inject(queueConfig.KEY)
    private readonly queueCfg: ConfigType<typeof queueConfig>,
  ) {
    this.pollTimer = setInterval(() => this.processQueue(), 3000);
    this.cleanupTimer = setInterval(async () => {
      try {
        const removed = await this.queueService.cleanCompleted();
        if (removed > 0) {
          this.logger.log(`Queue cleanup: ${removed} completed jobs removed`);
        }
      } catch (err) {
        this.logger.error(`Queue cleanup error: ${(err as Error).message}`);
      }
    }, 3600000); // 1 hour
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [jobId, proc] of this.activeProcesses) {
      this.killProcess(proc, jobId);
    }
  }

  validatePrompt(prompt: string): { valid: boolean; reason?: string } {
    const trimmed = prompt?.trim();

    if (!trimmed || trimmed.length === 0) {
      return { valid: false, reason: 'Empty prompt' };
    }

    if (trimmed.length > this.secCfg.maxPromptLength) {
      return {
        valid: false,
        reason: `Prompt exceeds max length (${this.secCfg.maxPromptLength})`,
      };
    }

    const lower = trimmed.toLowerCase();
    for (const blocked of this.secCfg.blockedCommands) {
      if (lower.includes(blocked.toLowerCase())) {
        return { valid: false, reason: `Blocked command detected: ${blocked}` };
      }
    }

    return { valid: true };
  }

  needsConfirmation(prompt: string): string | null {
    const lower = prompt.toLowerCase();
    for (const cmd of this.secCfg.confirmCommands) {
      if (lower.includes(cmd.toLowerCase())) {
        return cmd;
      }
    }
    return null;
  }

  async submitJob(
    prompt: string,
    requestedBy: string,
    options?: { thread_ts?: string; channel?: string; mode?: ExecutionMode },
  ): Promise<ExecutionJob> {
    return this.queueService.enqueue(prompt, requestedBy, options);
  }

  async cancelJobById(jobIdPrefix: string): Promise<ExecutionJob | null> {
    const job = await this.queueService.findJobByPrefix(jobIdPrefix);
    if (!job) return null;

    const cancelled = await this.queueService.cancelJob(job.id);
    if (cancelled && cancelled.pid) {
      const proc = this.activeProcesses.get(cancelled.id);
      if (proc) {
        this.killProcess(proc, cancelled.id);
      }
    }
    return cancelled;
  }

  async stopJobByThreadTs(threadTs: string): Promise<ExecutionJob | null> {
    const job = await this.queueService.getRunningJobByThreadTs(threadTs);
    if (!job) return null;

    const stopped = await this.queueService.stopJob(job.id);
    if (stopped && stopped.pid) {
      const proc = this.activeProcesses.get(stopped.id);
      if (proc) {
        this.killProcess(proc, stopped.id);
      }
    }
    return stopped;
  }

  private async processQueue(): Promise<void> {
    try {
      const job = await this.queueService.dequeue();
      if (!job) return;

      await this.execute(job);
    } catch (err) {
      this.logger.error(`Queue processing error: ${(err as Error).message}`);
    }
  }

  private buildModePrompt(prompt: string, mode?: ExecutionMode): string {
    switch (mode) {
      case 'plan':
        return `[PLAN MODE] ${prompt}`;
      case 'brainstorm':
        return `[BRAINSTORM MODE] ${prompt}`;
      case 'analyze':
        return `[ANALYZE MODE] ${prompt}`;
      case 'review':
        return `[REVIEW MODE] ${prompt}`;
      default:
        return prompt;
    }
  }

  private async execute(job: ExecutionJob): Promise<void> {
    const channelId = job.channel || this.slackService.getChannelId();
    const startMsg = buildExecutionStartMessage(job, channelId);
    const postResult = await this.slackService.postMessage({
      ...startMsg,
      thread_ts: job.thread_ts,
    });

    // If no thread_ts yet, use the posted message's ts as thread root
    if (!job.thread_ts && postResult.ts) {
      job.thread_ts = postResult.ts;
      await this.queueService.updateJob(job.id, { thread_ts: postResult.ts });
    }

    const startTime = Date.now();
    const workingDir = job.workingDir || this.pathsCfg.workingDir;
    const modePrompt = this.buildModePrompt(job.prompt, job.mode);

    try {
      const proc = spawn('claude', ['-p', modePrompt, '--output-format', 'json'], {
        cwd: workingDir,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(job.id, proc);
      await this.queueService.updateJob(job.id, { pid: proc.pid });

      const result = await this.waitForProcess(proc, job.id);
      const durationMs = Date.now() - startTime;

      // Check if the job was stopped/cancelled externally during execution
      const currentJob = await this.queueService.findJobByThreadTs(job.thread_ts || '');
      const wasStoppedExternally = currentJob && (currentJob.status === 'stopped' || currentJob.status === 'cancelled');

      if (wasStoppedExternally) {
        this.logger.log(`Job ${job.id.slice(0, 8)} was stopped externally, skipping completion update`);
        return;
      }

      const execResult: ExecutionResult = {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
      };

      await this.queueService.updateJob(job.id, {
        status: result.exitCode === 0 ? 'completed' : 'failed',
        result: execResult,
        completedAt: new Date().toISOString(),
      });

      job.status = result.exitCode === 0 ? 'completed' : 'failed';
      job.result = execResult;

      const completeMsg = buildExecutionCompleteMessage(job, channelId);
      await this.slackService.postMessage({
        ...completeMsg,
        thread_ts: job.thread_ts,
      });
    } catch (err) {
      // Check if externally stopped before posting error
      const currentJob = await this.queueService.findJobByThreadTs(job.thread_ts || '');
      const wasStoppedExternally = currentJob && (currentJob.status === 'stopped' || currentJob.status === 'cancelled');

      if (wasStoppedExternally) {
        this.logger.log(`Job ${job.id.slice(0, 8)} was stopped externally, skipping error update`);
        return;
      }

      const error = (err as Error).message;
      await this.queueService.updateJob(job.id, {
        status: 'failed',
        error,
        completedAt: new Date().toISOString(),
      });

      job.status = 'failed';
      job.error = error;
      const completeMsg = buildExecutionCompleteMessage(job, channelId);
      await this.slackService.postMessage({
        ...completeMsg,
        thread_ts: job.thread_ts,
      });
    } finally {
      this.activeProcesses.delete(job.id);
    }
  }

  private waitForProcess(
    proc: ChildProcess,
    jobId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.killProcess(proc, jobId);
          reject(new Error(`Execution timeout (${this.queueCfg.timeoutMs}ms)`));
        }
      }, this.queueCfg.timeoutMs);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ exitCode: code ?? 1, stdout, stderr });
        }
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private killProcess(proc: ChildProcess, jobId: string): void {
    try {
      if (proc.pid) {
        treeKill(proc.pid, 'SIGTERM', (err) => {
          if (err) {
            this.logger.error(
              `Failed to kill process ${proc.pid}: ${(err as Error).message}`,
            );
          } else {
            this.logger.log(
              `Process killed: job=${jobId.slice(0, 8)} pid=${proc.pid}`,
            );
          }
        });
      }
    } catch (err) {
      this.logger.error(`Failed to kill process: ${(err as Error).message}`);
    }
  }
}
