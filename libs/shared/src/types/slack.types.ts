export interface ParsedAction {
  action: 'approve' | 'reject' | 'custom_reply' | 'option_select';
  sessionId: string;
  questionId: string;
  optionIndex?: number;
}

export interface ContextInjection {
  type: 'context_injection';
  sessionId: string;
  message: string;
  injectedBy: string;
  injectedAt: string;
}
