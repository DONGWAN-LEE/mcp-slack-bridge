import { CommandWatcherService } from './command-watcher.service';

let watchCallback: ((eventType: string, filename: string | null) => void) | null = null;
const mockClose = jest.fn();
const eventHandlers: Record<string, (...args: unknown[]) => void> = {};

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  watch: jest.fn().mockImplementation((_dir: string, cb: (...args: unknown[]) => void) => {
    watchCallback = cb as (eventType: string, filename: string | null) => void;
    return {
      close: mockClose,
      on: jest.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers[event] = handler;
      }),
    };
  }),
}));

describe('CommandWatcherService', () => {
  let service: CommandWatcherService;
  let mockMcpServer: { sendLoggingMessage: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation();
    watchCallback = null;
    Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);

    const pathsCfg = { stateDir: '/tmp/state', workingDir: '/tmp/work' };
    service = new CommandWatcherService(pathsCfg as any);

    mockMcpServer = {
      sendLoggingMessage: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('should call fs.watch on commands directory', () => {
    const { watch: fsWatch } = require('fs');
    service.startWatching('session-123', mockMcpServer as any);

    expect(fsWatch).toHaveBeenCalledWith(
      expect.stringContaining('session-123'),
      expect.any(Function),
    );
  });

  it('should send logging message when new .json file detected', () => {
    service.startWatching('session-123', mockMcpServer as any);

    expect(watchCallback).not.toBeNull();
    watchCallback!('rename', 'cmd-001.json');

    expect(mockMcpServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'slack-bridge',
      data: expect.stringContaining('slack_check_commands'),
    });
  });

  it('should debounce notifications within 5 seconds', () => {
    service.startWatching('session-123', mockMcpServer as any);

    watchCallback!('rename', 'cmd-001.json');
    watchCallback!('rename', 'cmd-002.json');
    watchCallback!('rename', 'cmd-003.json');

    expect(mockMcpServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
  });

  it('should ignore non-json files', () => {
    service.startWatching('session-123', mockMcpServer as any);

    watchCallback!('rename', 'readme.txt');
    watchCallback!('rename', null);

    expect(mockMcpServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('should close watcher on module destroy', () => {
    service.startWatching('session-123', mockMcpServer as any);
    service.onModuleDestroy();

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('should not start watching if directory does not exist', () => {
    const { existsSync, watch: fsWatch } = require('fs');
    (existsSync as jest.Mock).mockReturnValueOnce(false);

    service.startWatching('missing-session', mockMcpServer as any);

    expect(fsWatch).not.toHaveBeenCalled();
  });

  it('should handle watcher error event gracefully', () => {
    service.startWatching('session-123', mockMcpServer as any);

    expect(eventHandlers['error']).toBeDefined();
    eventHandlers['error'](new Error('watch failed'));

    expect(console.error).toHaveBeenCalledWith(
      '[CommandWatcher] Watcher error:',
      expect.any(Error),
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('should log error when sendLoggingMessage fails', async () => {
    mockMcpServer.sendLoggingMessage.mockRejectedValueOnce(new Error('send failed'));
    service.startWatching('session-123', mockMcpServer as any);

    watchCallback!('rename', 'cmd-001.json');

    await new Promise((r) => setImmediate(r));

    expect(console.error).toHaveBeenCalledWith(
      '[CommandWatcher] Notification failed:',
      expect.any(Error),
    );
  });

  it('should close previous watcher when startWatching is called again', () => {
    service.startWatching('session-1', mockMcpServer as any);
    service.startWatching('session-2', mockMcpServer as any);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
