import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { QuestionFile } from '@app/shared/types/question.types';

const DEFAULT_TIMEOUT_MS = 1800000; // 30 minutes
const POLL_INTERVAL_MS = 1000;

export function registerSlackAskTool(
  mcpServer: McpServer,
  sessionService: SessionService,
  fileBridge: FileBridgeService,
): void {
  mcpServer.tool(
    'slack_ask',
    'Slack으로 질문을 보내고 사용자 응답을 기다립니다. 멀티세션 환경에서 현재 세션에 바인딩됩니다.',
    {
      question: z.string().describe('질문 내용'),
      options: z.array(z.string()).optional().describe('선택지 (선택사항)'),
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
      const questionId = `q-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;

      const questionFile: QuestionFile = {
        questionId,
        sessionId,
        question: args.question,
        options: args.options,
        createdAt: new Date().toISOString(),
        timeout,
        status: 'pending',
      };

      try {
        fileBridge.writeQuestion(questionFile);
      } catch (err) {
        console.error(`[slack_ask] Failed to write question: ${(err as Error).message}`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'write_failed', message: (err as Error).message }) }],
          isError: true,
        };
      }

      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        try {
          const response = fileBridge.readResponse(sessionId, questionId);
          if (response) {
            fileBridge.updateQuestionStatus(sessionId, questionId, 'answered');
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
          console.error(`[slack_ask] Poll error: ${(pollErr as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      fileBridge.updateQuestionStatus(sessionId, questionId, 'expired');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'timeout', message: '응답 시간 초과' }) }],
        isError: true,
      };
    },
  );
}
