export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped';

export type ExecutionMode = 'default' | 'plan' | 'brainstorm' | 'analyze' | 'review';

export interface ExecutionJob {
  id: string;
  prompt: string;
  requestedBy: string;
  requestedAt: string;
  status: ExecutionStatus;
  pid?: number;
  workingDir?: string;
  result?: ExecutionResult;
  completedAt?: string;
  cancelledAt?: string;
  stoppedAt?: string;
  error?: string;
  thread_ts?: string;
  channel?: string;
  mode?: ExecutionMode;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface QueueFile {
  queue: ExecutionJob[];
}
