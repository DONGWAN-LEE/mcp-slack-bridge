import { registerSlackCommandResultTool } from './slack-command-result.tool';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { SessionMeta } from '@app/shared/types/session.types';

describe('slack_command_result tool', () => {
  let mockMcpServer: any;
  let sessionService: Partial<SessionService>;
  let fileBridge: Partial<FileBridgeService>;
  let toolHandler: (args: any) => Promise<any>;

  const mockSession: SessionMeta = {
    sessionId: 'sess-1',
    environment: { terminal: 'vscode', pid: 1234, shell: 'bash', displayName: 'VS Code' },
    projectPath: '/test',
    projectName: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-01-01T00:00:00Z',
    status: 'active',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockMcpServer = {
      tool: jest.fn((name: string, desc: string, schema: any, handler: any) => {
        toolHandler = handler;
      }),
    };

    sessionService = {
      getSession: jest.fn().mockReturnValue(mockSession),
    };

    fileBridge = {
      writeCommandResult: jest.fn(),
      updateCommandStatus: jest.fn(),
    };

    registerSlackCommandResultTool(
      mockMcpServer,
      sessionService as SessionService,
      fileBridge as FileBridgeService,
    );
  });

  it('should register tool with name slack_command_result', () => {
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'slack_command_result',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('should write result and update status on success', async () => {
    const result = await toolHandler({
      commandId: 'cmd-1',
      result: 'Tests passed',
      status: 'success',
    });

    expect(fileBridge.writeCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'cmd-1',
        sessionId: 'sess-1',
        result: 'Tests passed',
        status: 'success',
      }),
    );
    expect(fileBridge.updateCommandStatus).toHaveBeenCalledWith(
      'sess-1',
      'cmd-1',
      'completed',
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.commandId).toBe('cmd-1');
  });

  it('should handle error status', async () => {
    const result = await toolHandler({
      commandId: 'cmd-2',
      result: 'Build failed',
      status: 'error',
    });

    expect(fileBridge.writeCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'cmd-2',
        status: 'error',
      }),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('should return error when no session exists', async () => {
    (sessionService.getSession as jest.Mock).mockReturnValue(null);

    const result = await toolHandler({
      commandId: 'cmd-3',
      result: 'test',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('no_session');
  });

  it('should default status to success when not provided', async () => {
    await toolHandler({
      commandId: 'cmd-4',
      result: 'Done',
    });

    expect(fileBridge.writeCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
      }),
    );
  });
});
