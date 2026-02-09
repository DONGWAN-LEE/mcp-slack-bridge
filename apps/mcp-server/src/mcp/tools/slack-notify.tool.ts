import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { NotificationFile } from '@app/shared/types/notification.types';

export function registerSlackNotifyTool(
  mcpServer: McpServer,
  sessionService: SessionService,
  fileBridge: FileBridgeService,
): void {
  mcpServer.tool(
    'slack_notify',
    'Slack으로 단방향 알림을 보냅니다. 응답을 기다리지 않습니다.',
    {
      message: z.string().describe('알림 내용'),
      level: z.enum(['info', 'warning', 'error']).optional().describe('알림 레벨'),
    },
    async (args) => {
      const session = sessionService.getSession();
      if (!session) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'no_session', message: '활성 세션이 없습니다' }) }],
          isError: true,
        };
      }

      const sessionId = session.sessionId;
      const notificationId = `n-${Date.now()}`;

      const notification: NotificationFile = {
        notificationId,
        sessionId,
        message: args.message,
        level: args.level ?? 'info',
        createdAt: new Date().toISOString(),
      };

      fileBridge.writeNotification(notification);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ sent: true, notificationId }) }],
      };
    },
  );
}
