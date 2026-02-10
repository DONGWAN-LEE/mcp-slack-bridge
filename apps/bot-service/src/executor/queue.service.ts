import { Injectable, Inject, Logger } from '@nestjs/common';
import { join } from 'path';
import {
  pathsConfig,
  queueConfig,
} from '@app/shared/config/configuration';
import {
  readJsonFile,
  atomicWriteJson,
  FileLock,
} from '@app/shared/utils/file.utils';
import {
  ExecutionJob,
  ExecutionMode,
  QueueFile,
  ExecutionStatus,
} from '@app/shared/types/executor.types';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly lock: FileLock;
  private readonly queuePath: string;

  constructor(
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
    @Inject(queueConfig.KEY)
    private readonly queueCfg: ConfigType<typeof queueConfig>,
  ) {
    this.queuePath = join(this.pathsCfg.stateDir, 'execution-queue.json');
    this.lock = new FileLock(this.queuePath);
  }

  async enqueue(
    prompt: string,
    requestedBy: string,
    options?: { thread_ts?: string; channel?: string; mode?: ExecutionMode },
  ): Promise<ExecutionJob> {
    await this.lock.acquire();
    try {
      const queue = this.readQueue();
      const activeCount = queue.queue.filter(
        (j) => j.status === 'queued' || j.status === 'running',
      ).length;

      if (activeCount >= this.queueCfg.maxSize) {
        throw new Error(
          `Queue is full (${activeCount}/${this.queueCfg.maxSize})`,
        );
      }

      const job: ExecutionJob = {
        id: randomUUID(),
        prompt,
        requestedBy,
        requestedAt: new Date().toISOString(),
        status: 'queued',
        thread_ts: options?.thread_ts,
        channel: options?.channel,
        mode: options?.mode,
      };

      queue.queue.push(job);
      atomicWriteJson(this.queuePath, queue);
      this.logger.log(`Job enqueued: ${job.id.slice(0, 8)} by ${requestedBy} mode=${options?.mode || 'default'}`);
      return job;
    } finally {
      this.lock.release();
    }
  }

  async dequeue(): Promise<ExecutionJob | null> {
    await this.lock.acquire();
    try {
      const queue = this.readQueue();
      const runningCount = queue.queue.filter(
        (j) => j.status === 'running',
      ).length;

      if (runningCount >= this.queueCfg.maxConcurrent) {
        return null;
      }

      const next = queue.queue.find((j) => j.status === 'queued');
      if (!next) return null;

      next.status = 'running';
      atomicWriteJson(this.queuePath, queue);
      return next;
    } finally {
      this.lock.release();
    }
  }

  async updateJob(
    jobId: string,
    updates: Partial<Pick<ExecutionJob, 'status' | 'pid' | 'result' | 'completedAt' | 'error' | 'cancelledAt' | 'stoppedAt' | 'thread_ts'>>,
  ): Promise<void> {
    await this.lock.acquire();
    try {
      const queue = this.readQueue();
      const job = queue.queue.find((j) => j.id === jobId);
      if (!job) return;

      Object.assign(job, updates);
      atomicWriteJson(this.queuePath, queue);
    } finally {
      this.lock.release();
    }
  }

  async getRunningJobs(): Promise<ExecutionJob[]> {
    const queue = this.readQueue();
    return queue.queue.filter((j) => j.status === 'running');
  }

  async getQueuedJobs(): Promise<ExecutionJob[]> {
    const queue = this.readQueue();
    return queue.queue.filter((j) => j.status === 'queued');
  }

  async cancelJob(jobId: string): Promise<ExecutionJob | null> {
    await this.lock.acquire();
    try {
      const queue = this.readQueue();
      const job = queue.queue.find(
        (j) => j.id === jobId && (j.status === 'queued' || j.status === 'running'),
      );
      if (!job) return null;

      job.status = 'cancelled';
      job.cancelledAt = new Date().toISOString();
      atomicWriteJson(this.queuePath, queue);
      return job;
    } finally {
      this.lock.release();
    }
  }

  async findJobByPrefix(prefix: string): Promise<ExecutionJob | null> {
    const queue = this.readQueue();
    const matches = queue.queue.filter(
      (j) =>
        j.id.startsWith(prefix) &&
        (j.status === 'queued' || j.status === 'running'),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  async findJobByThreadTs(threadTs: string): Promise<ExecutionJob | null> {
    const queue = this.readQueue();
    const matches = queue.queue.filter((j) => j.thread_ts === threadTs);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async getRunningJobByThreadTs(threadTs: string): Promise<ExecutionJob | null> {
    const queue = this.readQueue();
    return (
      queue.queue.find(
        (j) => j.thread_ts === threadTs && (j.status === 'running' || j.status === 'queued'),
      ) || null
    );
  }

  async stopJob(jobId: string): Promise<ExecutionJob | null> {
    await this.lock.acquire();
    try {
      const queue = this.readQueue();
      const job = queue.queue.find(
        (j) => j.id === jobId && (j.status === 'queued' || j.status === 'running'),
      );
      if (!job) return null;

      job.status = 'stopped';
      job.stoppedAt = new Date().toISOString();
      atomicWriteJson(this.queuePath, queue);
      return job;
    } finally {
      this.lock.release();
    }
  }

  async cleanCompleted(): Promise<void> {
    await this.lock.acquire();
    try {
      const queue = this.readQueue();
      const cutoff = Date.now() - 3600000; // 1 hour
      queue.queue = queue.queue.filter((j) => {
        if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled' || j.status === 'stopped') {
          const completedMs = j.completedAt
            ? new Date(j.completedAt).getTime()
            : j.cancelledAt
              ? new Date(j.cancelledAt).getTime()
              : j.stoppedAt
                ? new Date(j.stoppedAt).getTime()
                : 0;
          return completedMs > cutoff;
        }
        return true;
      });
      atomicWriteJson(this.queuePath, queue);
    } finally {
      this.lock.release();
    }
  }

  private readQueue(): QueueFile {
    return readJsonFile<QueueFile>(this.queuePath) || { queue: [] };
  }
}
