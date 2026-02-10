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
import { ExecutionJob, ExecutionResult } from '@app/shared/types/executor.types';
import * as treeKill from 'tree-kill';

@Injectable()
export class ExecutorService implements OnModuleDestroy {
  private readonly logger = new Logger(ExecutorService.name);
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

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
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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

  async submitJob(prompt: string, requestedBy: string): Promise<ExecutionJob> {
    return this.queueService.enqueue(prompt, requestedBy);
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

  private async processQueue(): Promise<void> {
    try {
      const job = await this.queueService.dequeue();
      if (!job) return;

      await this.execute(job);
    } catch (err) {
      this.logger.error(`Queue processing error: ${(err as Error).message}`);
    }
  }

  private async execute(job: ExecutionJob): Promise<void> {
    const channelId = this.slackService.getChannelId();
    const startMsg = buildExecutionStartMessage(job, channelId);
    await this.slackService.postMessage(startMsg);

    const startTime = Date.now();
    const workingDir = job.workingDir || this.pathsCfg.workingDir;

    try {
      const proc = spawn('claude', ['-p', job.prompt, '--output-format', 'json'], {
        cwd: workingDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(job.id, proc);
      await this.queueService.updateJob(job.id, { pid: proc.pid });

      const result = await this.waitForProcess(proc, job.id);
      const durationMs = Date.now() - startTime;

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
      await this.slackService.postMessage(completeMsg);
    } catch (err) {
      const error = (err as Error).message;
      await this.queueService.updateJob(job.id, {
        status: 'failed',
        error,
        completedAt: new Date().toISOString(),
      });

      job.status = 'failed';
      job.error = error;
      const completeMsg = buildExecutionCompleteMessage(job, channelId);
      await this.slackService.postMessage(completeMsg);
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
