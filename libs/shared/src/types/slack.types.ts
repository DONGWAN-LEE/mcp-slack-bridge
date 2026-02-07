export interface ParsedAction {
  action: 'approve' | 'reject' | 'custom_reply';
  sessionId: string;
  questionId: string;
}

export interface ContextInjection {
  type: 'context_injection';
  sessionId: string;
  message: string;
  injectedBy: string;
  injectedAt: string;
}
