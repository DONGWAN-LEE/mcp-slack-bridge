import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';

const DEFAULT_TIMEOUT_MS = 1800000; // 30 minutes
const POLL_INTERVAL_MS = 1000;

export function registerSlackWaitTool(
  mcpServer: McpServer,
  sessionService: SessionService,
  fileBridge: FileBridgeService,
): void {
  mcpServer.tool(
    'slack_wait_response',
    '이전에 보낸 질문에 대한 응답을 대기합니다.',
    {
      questionId: z.string().describe('응답을 기다릴 질문 ID'),
      timeout: z.number().optional().describe('응답 대기 시간(ms), 기본 1800000 (30분)'),
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
      const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        try {
          const response = fileBridge.readResponse(sessionId, args.questionId);
          if (response) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  answer: response.answer,
                  respondedBy: response.respondedBy,
                  timestamp: response.respondedAt,
                }),
              }],
            };
          }
        } catch (pollErr) {
          console.error(`[slack_wait_response] Poll error: ${(pollErr as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'timeout', message: '응답 시간 초과' }) }],
        isError: true,
      };
    },
  );
}
