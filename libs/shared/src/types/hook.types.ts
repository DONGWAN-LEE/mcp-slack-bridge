export interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  message?: string;
}

export interface CurrentSessionFile {
  sessionId: string;
  projectPath: string;
  createdAt: string;
  pid: number;
}
