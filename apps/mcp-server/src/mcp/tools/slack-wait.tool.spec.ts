import { registerSlackWaitTool } from './slack-wait.tool';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { SessionMeta } from '@app/shared/types/session.types';

describe('slack_wait_response tool', () => {
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
    jest.useFakeTimers();

    mockMcpServer = {
      tool: jest.fn((name: string, desc: string, schema: any, handler: any) => {
        toolHandler = handler;
      }),
    };

    sessionService = {
      getSession: jest.fn().mockReturnValue(mockSession),
    };

    fileBridge = {
      readResponse: jest.fn().mockReturnValue(null),
    };

    registerSlackWaitTool(
      mockMcpServer,
      sessionService as SessionService,
      fileBridge as FileBridgeService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should register tool with name slack_wait_response', () => {
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'slack_wait_response',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('should return error when no session exists', async () => {
    (sessionService.getSession as jest.Mock).mockReturnValue(null);

    const result = await toolHandler({ questionId: 'q-123' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('no_session');
  });

  it('should return answer when response exists', async () => {
    const mockResponse = {
      questionId: 'q-123',
      answer: 'Approved',
      respondedBy: 'U456',
      respondedAt: '2026-01-01T00:05:00Z',
      source: 'slack_button',
    };

    (fileBridge.readResponse as jest.Mock).mockReturnValue(mockResponse);

    const resultPromise = toolHandler({ questionId: 'q-123' });
    jest.advanceTimersByTime(1000);
    const result = await resultPromise;

    expect(JSON.parse(result.content[0].text).answer).toBe('Approved');
    expect(result.isError).toBeUndefined();
  });

  it('should return timeout error when no response within timeout', async () => {
    (fileBridge.readResponse as jest.Mock).mockReturnValue(null);

    const resultPromise = toolHandler({ questionId: 'q-123', timeout: 3000 });

    jest.advanceTimersByTime(4000);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('timeout');
  });
});
