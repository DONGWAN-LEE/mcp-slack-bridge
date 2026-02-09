import { registerSlackNotifyTool } from './slack-notify.tool';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { SessionMeta } from '@app/shared/types/session.types';

describe('slack_notify tool', () => {
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
    mockMcpServer = {
      tool: jest.fn((name: string, desc: string, schema: any, handler: any) => {
        toolHandler = handler;
      }),
    };

    sessionService = {
      getSession: jest.fn().mockReturnValue(mockSession),
    };

    fileBridge = {
      writeNotification: jest.fn(),
    };

    registerSlackNotifyTool(
      mockMcpServer,
      sessionService as SessionService,
      fileBridge as FileBridgeService,
    );
  });

  it('should register tool with name slack_notify', () => {
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'slack_notify',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('should return error when no session exists', async () => {
    (sessionService.getSession as jest.Mock).mockReturnValue(null);

    const result = await toolHandler({ message: 'Hello' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('no_session');
  });

  it('should write notification and return sent: true', async () => {
    const result = await toolHandler({ message: 'Build complete' });

    expect(fileBridge.writeNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        message: 'Build complete',
        level: 'info',
      }),
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sent).toBe(true);
    expect(parsed.notificationId).toMatch(/^n-/);
  });

  it('should use specified level', async () => {
    await toolHandler({ message: 'Error!', level: 'error' });

    expect(fileBridge.writeNotification).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });
});
