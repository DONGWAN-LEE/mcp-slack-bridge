import { registerSlackAskTool } from './slack-ask.tool';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { SessionMeta } from '@app/shared/types/session.types';

describe('slack_ask tool', () => {
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
      writeQuestion: jest.fn(),
      readResponse: jest.fn().mockReturnValue(null),
      updateQuestionStatus: jest.fn(),
    };

    registerSlackAskTool(
      mockMcpServer,
      sessionService as SessionService,
      fileBridge as FileBridgeService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should register tool with name slack_ask', () => {
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'slack_ask',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('should return error when no session exists', async () => {
    (sessionService.getSession as jest.Mock).mockReturnValue(null);

    const result = await toolHandler({ question: 'Test?' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('no_session');
  });

  it('should write question and return answer on immediate response', async () => {
    const mockResponse = {
      questionId: 'q-123',
      answer: 'Yes',
      respondedBy: 'U123',
      respondedAt: '2026-01-01T00:01:00Z',
      source: 'slack_button',
    };

    (fileBridge.readResponse as jest.Mock).mockReturnValue(mockResponse);

    const resultPromise = toolHandler({ question: 'Approve?' });

    // Advance past the first poll interval
    jest.advanceTimersByTime(1000);
    const result = await resultPromise;

    expect(fileBridge.writeQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        question: 'Approve?',
        status: 'pending',
      }),
    );
    expect(fileBridge.updateQuestionStatus).toHaveBeenCalledWith('sess-1', expect.any(String), 'answered');
    expect(JSON.parse(result.content[0].text).answer).toBe('Yes');
  });

  it('should return timeout error when no response within timeout', async () => {
    (fileBridge.readResponse as jest.Mock).mockReturnValue(null);

    const resultPromise = toolHandler({ question: 'Test?', timeout: 3000 });

    // Advance past the timeout
    jest.advanceTimersByTime(4000);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('timeout');
    expect(fileBridge.updateQuestionStatus).toHaveBeenCalledWith('sess-1', expect.any(String), 'expired');
  });
});
