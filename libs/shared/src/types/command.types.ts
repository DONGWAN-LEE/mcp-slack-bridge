export interface CommandFile {
  commandId: string; // "cmd-{timestamp}-{uuid8}"
  sessionId: string;
  command: string;
  requestedBy: string;
  createdAt: string;
  status: 'pending' | 'received' | 'executing' | 'completed' | 'failed';
}

export interface CommandResultFile {
  commandId: string;
  sessionId: string;
  result: string;
  status: 'success' | 'error';
  completedAt: string;
  posted?: boolean; // Bot posted to Slack
}
