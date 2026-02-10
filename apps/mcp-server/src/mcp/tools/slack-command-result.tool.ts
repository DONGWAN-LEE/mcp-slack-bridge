import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { CommandResultFile } from '@app/shared/types/command.types';

export function registerSlackCommandResultTool(
  mcpServer: McpServer,
  sessionService: SessionService,
  fileBridge: FileBridgeService,
): void {
  mcpServer.tool(
    'slack_command_result',
    '실행한 명령의 결과를 Slack에 보고합니다.',
    {
      commandId: z.string().describe('실행한 명령 ID'),
      result: z.string().describe('실행 결과 텍스트'),
      status: z.enum(['success', 'error']).optional().describe('결과 상태 (기본: success)'),
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
      const resultFile: CommandResultFile = {
        commandId: args.commandId,
        sessionId,
        result: args.result,
        status: args.status ?? 'success',
        completedAt: new Date().toISOString(),
      };

      fileBridge.writeCommandResult(resultFile);
      fileBridge.updateCommandStatus(sessionId, args.commandId, 'completed');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, commandId: args.commandId }),
        }],
      };
    },
  );
}
