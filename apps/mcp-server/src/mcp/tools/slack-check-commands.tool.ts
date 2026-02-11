import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes
const POLL_INTERVAL_MS = 1000;

export function registerSlackCheckCommandsTool(
  mcpServer: McpServer,
  sessionService: SessionService,
  fileBridge: FileBridgeService,
): void {
  mcpServer.tool(
    'slack_check_commands',
    'Slack에서 전달된 명령을 확인합니다. 블로킹 모드에서는 새 명령이 올 때까지 대기합니다.',
    {
      blocking: z.boolean().optional().describe('블로킹 모드 (기본: true). false이면 즉시 반환'),
      timeout: z.number().optional().describe('블로킹 타임아웃(ms), 기본 300000 (5분)'),
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
      const blocking = args.blocking ?? true;
      const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;

      try {
        // Non-blocking: check once and return
        if (!blocking) {
          const commands = fileBridge.readPendingCommands(sessionId);
          for (const cmd of commands) {
            fileBridge.updateCommandStatus(sessionId, cmd.commandId, 'received');
          }
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                commands: commands.map((c) => ({
                  commandId: c.commandId,
                  command: c.command,
                  requestedBy: c.requestedBy,
                  createdAt: c.createdAt,
                })),
              }),
            }],
          };
        }

        // Blocking: poll until commands arrive or timeout
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          try {
            const commands = fileBridge.readPendingCommands(sessionId);
            if (commands.length > 0) {
              for (const cmd of commands) {
                fileBridge.updateCommandStatus(sessionId, cmd.commandId, 'received');
              }
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    commands: commands.map((c) => ({
                      commandId: c.commandId,
                      command: c.command,
                      requestedBy: c.requestedBy,
                      createdAt: c.createdAt,
                    })),
                  }),
                }],
              };
            }
          } catch (pollErr) {
            console.error(`[slack_check_commands] Poll error: ${(pollErr as Error).message}`);
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        // Timeout — no commands
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ commands: [], message: '대기 시간 초과, 명령 없음' }),
          }],
        };
      } catch (err) {
        console.error(`[slack_check_commands] Error: ${(err as Error).message}`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'internal_error', message: (err as Error).message }) }],
          isError: true,
        };
      }
    },
  );
}
