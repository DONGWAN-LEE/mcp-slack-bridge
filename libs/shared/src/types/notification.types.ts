export interface NotificationFile {
  notificationId: string;
  sessionId: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  createdAt: string;
  slackMessageTs?: string;
}
