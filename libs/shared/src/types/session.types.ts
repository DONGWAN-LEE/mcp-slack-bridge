export interface EnvironmentInfo {
  terminal:
    | 'vscode'
    | 'warp'
    | 'windows-terminal'
    | 'powershell'
    | 'iterm'
    | 'cmd'
    | 'unknown';
  pid: number;
  shell: 'powershell' | 'cmd' | 'bash' | 'zsh' | 'unknown';
  displayName: string;
}

export interface SessionMeta {
  sessionId: string;
  claudeSessionId?: string;
  environment: EnvironmentInfo;
  projectPath: string;
  projectName: string;
  gitBranch?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt?: string;
  status: 'active' | 'idle' | 'waiting' | 'terminated';
  slackThreadTs?: string;
}
