export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  error?: string;
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
