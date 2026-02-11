import { McpServerService } from './mcp-server.service';
import { SessionService } from '../session/session.service';
import { FileBridgeService } from '../bridge/file-bridge.service';
import { CommandWatcherService } from './command-watcher.service';

// Mock uuid ESM module (used by SessionService)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

// Mock file utils (used by SessionService)
jest.mock('@app/shared/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
  ensureDir: jest.fn(),
  touchFile: jest.fn(),
}));

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockTool = jest.fn();

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    tool: mockTool,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}));

describe('McpServerService', () => {
  let service: McpServerService;
  let sessionService: Partial<SessionService>;
  let fileBridge: Partial<FileBridgeService>;
  let commandWatcher: Partial<CommandWatcherService>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation();

    sessionService = { getSession: jest.fn() };
    fileBridge = {
      writeQuestion: jest.fn(),
      readResponse: jest.fn(),
      writeNotification: jest.fn(),
      updateQuestionStatus: jest.fn(),
    };
    commandWatcher = {
      startWatching: jest.fn(),
      stopWatching: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    service = new McpServerService(
      sessionService as SessionService,
      fileBridge as FileBridgeService,
      commandWatcher as CommandWatcherService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should create McpServer and register 5 tools', async () => {
      await service.onModuleInit();

      expect(mockTool).toHaveBeenCalledTimes(5);
      expect(mockTool).toHaveBeenCalledWith('slack_ask', expect.any(String), expect.any(Object), expect.any(Function));
      expect(mockTool).toHaveBeenCalledWith('slack_notify', expect.any(String), expect.any(Object), expect.any(Function));
      expect(mockTool).toHaveBeenCalledWith('slack_wait_response', expect.any(String), expect.any(Object), expect.any(Function));
      expect(mockTool).toHaveBeenCalledWith('slack_check_commands', expect.any(String), expect.any(Object), expect.any(Function));
      expect(mockTool).toHaveBeenCalledWith('slack_command_result', expect.any(String), expect.any(Object), expect.any(Function));
    });

    it('should connect via StdioServerTransport', async () => {
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should start command watcher when session exists', async () => {
      const mockSession = { sessionId: 'test-session-id' };
      (sessionService.getSession as jest.Mock).mockReturnValue(mockSession);

      await service.onModuleInit();

      expect(commandWatcher.startWatching).toHaveBeenCalledWith(
        'test-session-id',
        expect.any(Object),
      );
    });

    it('should not start command watcher when no session', async () => {
      (sessionService.getSession as jest.Mock).mockReturnValue(null);

      await service.onModuleInit();

      expect(commandWatcher.startWatching).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop command watcher and close McpServer', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(commandWatcher.stopWatching).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
