export interface QuestionFile {
  questionId: string;
  sessionId: string;
  question: string;
  options?: string[];
  context?: string;
  createdAt: string;
  timeout: number;
  status: 'pending' | 'answered' | 'expired';
  slackMessageTs?: string;
}

export interface ResponseFile {
  questionId: string;
  answer: string;
  respondedBy: string;
  respondedAt: string;
  source: 'slack_button' | 'slack_text' | 'slack_inject' | 'cli';
}
