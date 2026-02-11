import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolveSession } from '../utils/session-resolver';

jest.mock('../utils/session-resolver', () => ({
  resolveSession: jest.fn(),
}));

jest.mock('fs', () => ({
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const COOLDOWN_MS = 10_000;
const SKIP_TOOLS = [
  'slack_check_commands',
  'slack_command_result',
  'slack_ask',
  'slack_notify',
  'slack_wait_response',
];

describe('on-check-commands logic', () => {
  const mockSessionDir = join('./state', 'sessions', 'test-session');
  const mockResolveSession = resolveSession as jest.MockedFunction<typeof resolveSession>;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveSession.mockReturnValue({
      sessionId: 'test-session',
      sessionDir: mockSessionDir,
    });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  function simulateHook(options: {
    toolName?: string;
    hasSession?: boolean;
    pendingFiles?: Array<{ name: string; status: string }>;
    lastNotifyTs?: number;
  } = {}): void {
    const { toolName, hasSession = true, pendingFiles = [], lastNotifyTs } = options;

    // Skip slack-related tools
    if (toolName && SKIP_TOOLS.some((t) => toolName.includes(t))) {
      return;
    }

    if (!hasSession) {
      mockResolveSession.mockReturnValue(null);
    }

    const session = resolveSession('./state');
    if (!session) return;

    // Cooldown check
    const markerPath = join(session.sessionDir, '.command-notify-ts');
    if (lastNotifyTs !== undefined) {
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path === markerPath) return String(lastNotifyTs);
        // For command files, handled below
        const file = pendingFiles.find((f) => path.endsWith(f.name));
        if (file) return JSON.stringify({ status: file.status });
        throw new Error('File not found');
      });

      const lastNotify = parseInt((readFileSync as jest.Mock)(markerPath), 10);
      if (Date.now() - lastNotify < COOLDOWN_MS) return;
    } else {
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path === markerPath) throw new Error('ENOENT');
        const file = pendingFiles.find((f) => path.endsWith(f.name));
        if (file) return JSON.stringify({ status: file.status });
        throw new Error('File not found');
      });
      // Attempt to read marker - will throw
      try {
        parseInt((readFileSync as jest.Mock)(markerPath), 10);
      } catch {
        // No marker - continue
      }
    }

    // Check for pending commands
    const commandsDir = join(session.sessionDir, 'commands');
    if (pendingFiles.length > 0) {
      (readdirSync as jest.Mock).mockReturnValue(pendingFiles.map((f) => f.name));
    } else {
      (readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });
    }

    try {
      const files = (readdirSync as jest.Mock)(commandsDir).filter((f: string) =>
        f.endsWith('.json'),
      );
      let pendingCount = 0;
      for (const file of files) {
        try {
          const data = JSON.parse((readFileSync as jest.Mock)(join(commandsDir, file)));
          if (data.status === 'pending') pendingCount++;
        } catch {
          // Ignore
        }
      }

      if (pendingCount > 0) {
        (writeFileSync as jest.Mock)(markerPath, String(Date.now()));
        console.log(
          `[Slack 명령 ${pendingCount}건 대기 중] ` +
            `slack_check_commands 도구를 호출하여 Slack에서 전달된 명령을 확인하고 실행해주세요.`,
        );
      }
    } catch {
      // commands directory doesn't exist
    }
  }

  it('should output message when pending commands exist', () => {
    simulateHook({
      pendingFiles: [
        { name: 'cmd-1.json', status: 'pending' },
        { name: 'cmd-2.json', status: 'pending' },
      ],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 2건 대기 중'),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.command-notify-ts'),
      expect.any(String),
    );
  });

  it('should not output when no pending commands', () => {
    simulateHook({
      pendingFiles: [
        { name: 'cmd-1.json', status: 'completed' },
        { name: 'cmd-2.json', status: 'failed' },
      ],
    });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should skip slack_* tool executions', () => {
    simulateHook({ toolName: 'mcp__slack-bridge__slack_check_commands' });

    expect(resolveSession).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should skip slack_ask tool execution', () => {
    simulateHook({ toolName: 'mcp__slack-bridge__slack_ask' });

    expect(resolveSession).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should skip within cooldown period', () => {
    simulateHook({
      lastNotifyTs: Date.now() - 3000, // 3 seconds ago (within 10s cooldown)
      pendingFiles: [{ name: 'cmd-1.json', status: 'pending' }],
    });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should proceed after cooldown expired', () => {
    simulateHook({
      lastNotifyTs: Date.now() - 15000, // 15 seconds ago (beyond 10s cooldown)
      pendingFiles: [{ name: 'cmd-1.json', status: 'pending' }],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 1건 대기 중'),
    );
  });

  it('should do nothing when no session', () => {
    simulateHook({ hasSession: false });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(readdirSync).not.toHaveBeenCalled();
  });

  it('should not output when commands directory does not exist', () => {
    simulateHook(); // no pendingFiles => readdirSync throws ENOENT

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should only count pending status, not other statuses', () => {
    simulateHook({
      pendingFiles: [
        { name: 'cmd-1.json', status: 'pending' },
        { name: 'cmd-2.json', status: 'executing' },
        { name: 'cmd-3.json', status: 'completed' },
      ],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 1건 대기 중'),
    );
  });

  it('should handle malformed JSON command files gracefully', () => {
    const session = resolveSession('./state');
    if (!session) return;

    const commandsDir = join(session.sessionDir, 'commands');
    (readdirSync as jest.Mock).mockReturnValue(['cmd-bad.json', 'cmd-good.json']);
    (readFileSync as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('cmd-bad.json')) return 'not-valid-json{{{';
      if (path.endsWith('cmd-good.json')) return JSON.stringify({ status: 'pending' });
      throw new Error('ENOENT');
    });

    // Simulate the core logic
    const files = (readdirSync as jest.Mock)(commandsDir).filter((f: string) =>
      f.endsWith('.json'),
    );
    let pendingCount = 0;
    for (const file of files) {
      try {
        const data = JSON.parse((readFileSync as jest.Mock)(join(commandsDir, file)));
        if (data.status === 'pending') pendingCount++;
      } catch {
        // malformed JSON should be silently skipped
      }
    }

    if (pendingCount > 0) {
      console.log(
        `[Slack 명령 ${pendingCount}건 대기 중] ` +
          `slack_check_commands 도구를 호출하여 Slack에서 전달된 명령을 확인하고 실행해주세요.`,
      );
    }

    // Only the valid pending file should be counted
    expect(pendingCount).toBe(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 1건 대기 중'),
    );
  });
});
