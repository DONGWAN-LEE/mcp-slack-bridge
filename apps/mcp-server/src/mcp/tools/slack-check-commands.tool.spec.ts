import { registerSlackCheckCommandsTool } from './slack-check-commands.tool';
import { SessionService } from '../../session/session.service';
import { FileBridgeService } from '../../bridge/file-bridge.service';
import { SessionMeta } from '@app/shared/types/session.types';
import { CommandFile } from '@app/shared/types/command.types';

describe('slack_check_commands tool', () => {
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

  const mockCommand: CommandFile = {
    commandId: 'cmd-1',
    sessionId: 'sess-1',
    command: 'run tests',
    requestedBy: 'U123',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'pending',
  };

  beforeEach(() => {
    jest.useFakeTimers();
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
      readPendingCommands: jest.fn().mockReturnValue([]),
      updateCommandStatus: jest.fn(),
    };

    registerSlackCheckCommandsTool(
      mockMcpServer,
      sessionService as SessionService,
      fileBridge as FileBridgeService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should register tool with name slack_check_commands', () => {
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'slack_check_commands',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('should return error when no session exists', async () => {
    (sessionService.getSession as jest.Mock).mockReturnValue(null);

    const result = await toolHandler({ blocking: false });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('no_session');
  });

  describe('non-blocking mode', () => {
    it('should return pending commands immediately', async () => {
      (fileBridge.readPendingCommands as jest.Mock).mockReturnValue([mockCommand]);

      const result = await toolHandler({ blocking: false });

      expect(fileBridge.readPendingCommands).toHaveBeenCalledTimes(1);
      expect(fileBridge.updateCommandStatus).toHaveBeenCalledWith(
        'sess-1',
        'cmd-1',
        'received',
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.commands).toHaveLength(1);
      expect(parsed.commands[0].commandId).toBe('cmd-1');
      expect(parsed.commands[0].command).toBe('run tests');
    });

    it('should return empty array when no commands', async () => {
      const result = await toolHandler({ blocking: false });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.commands).toEqual([]);
    });

    it('should include _meta with nextAction in non-blocking response with commands', async () => {
      (fileBridge.readPendingCommands as jest.Mock).mockReturnValue([mockCommand]);

      const result = await toolHandler({ blocking: false });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed._meta).toBeDefined();
      expect(parsed._meta.nextAction).toBe('process_then_resume');
      expect(parsed._meta.instruction).toContain('slack_command_result');
    });
  });

  describe('blocking mode', () => {
    it('should return immediately when commands exist on first poll', async () => {
      (fileBridge.readPendingCommands as jest.Mock).mockReturnValue([mockCommand]);

      const result = await toolHandler({ blocking: true });

      expect(fileBridge.readPendingCommands).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.commands).toHaveLength(1);
      expect(parsed.commands[0].commandId).toBe('cmd-1');
    });

    it('should include _meta with process_then_resume when commands found', async () => {
      (fileBridge.readPendingCommands as jest.Mock).mockReturnValue([mockCommand]);

      const result = await toolHandler({ blocking: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed._meta).toBeDefined();
      expect(parsed._meta.nextAction).toBe('process_then_resume');
      expect(parsed._meta.instruction).toContain('slack_check_commands(blocking=true)');
    });

    it('should return empty array with message on timeout', async () => {
      (fileBridge.readPendingCommands as jest.Mock).mockReturnValue([]);

      const handlerPromise = toolHandler({ blocking: true, timeout: 2000 });

      // Advance past timeout
      await jest.advanceTimersByTimeAsync(3000);

      const result = await handlerPromise;

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.commands).toEqual([]);
      expect(parsed.message).toBeDefined();
    });

    it('should include _meta with resume_wait on timeout', async () => {
      (fileBridge.readPendingCommands as jest.Mock).mockReturnValue([]);

      const handlerPromise = toolHandler({ blocking: true, timeout: 2000 });

      await jest.advanceTimersByTimeAsync(3000);

      const result = await handlerPromise;

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed._meta).toBeDefined();
      expect(parsed._meta.nextAction).toBe('resume_wait');
      expect(parsed._meta.instruction).toContain('slack_check_commands(blocking=true)');
    });
  });
});
