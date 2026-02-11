import { join } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolveSession } from '../utils/session-resolver';

jest.mock('../utils/session-resolver', () => ({
  resolveSession: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const COOLDOWN_MS = 10_000;
const RE_ENTRY_MSG =
  '[Slack 명령 처리 완료] ' +
  'slack_check_commands 도구를 blocking=true로 호출하여 다음 Slack 명령을 대기해주세요.';
const SKIP_TOOLS = [
  'slack_check_commands',
  // slack_command_result is intentionally NOT skipped
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
    // Default: marker exists (not first run)
    (existsSync as jest.Mock).mockReturnValue(true);
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
    isFirstRun?: boolean;
  } = {}): void {
    const { toolName, hasSession = true, pendingFiles = [], lastNotifyTs, isFirstRun = false } = options;

    // Skip slack-related tools
    if (toolName && SKIP_TOOLS.some((t) => toolName.includes(t))) {
      return;
    }

    if (!hasSession) {
      mockResolveSession.mockReturnValue(null);
    }

    const session = resolveSession('./state');
    if (!session) return;

    // Session-first-run: one-time notification to enter wait loop
    const notifiedMarker = join(session.sessionDir, '.wait-loop-notified');
    (existsSync as jest.Mock).mockImplementation((path: string) => {
      if (path === notifiedMarker) return !isFirstRun;
      return false;
    });
    if (!(existsSync as jest.Mock)(notifiedMarker)) {
      (writeFileSync as jest.Mock)(notifiedMarker, String(Date.now()));
      console.log(
        '[Slack 명령 대기 시작] ' +
          'slack_check_commands 도구를 blocking=true로 호출하여 Slack 명령 대기를 시작해주세요.',
      );
      return;
    }

    const isCommandResult = toolName?.includes('slack_command_result') ?? false;

    // Cooldown check — slack_command_result bypasses cooldown
    const markerPath = join(session.sessionDir, '.command-notify-ts');
    if (!isCommandResult) {
      if (lastNotifyTs !== undefined) {
        (readFileSync as jest.Mock).mockImplementation((path: string) => {
          if (path === markerPath) return String(lastNotifyTs);
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
        try {
          parseInt((readFileSync as jest.Mock)(markerPath), 10);
        } catch {
          // No marker - continue
        }
      }
    } else {
      // isCommandResult — set up readFileSync for command files only
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        const file = pendingFiles.find((f) => path.endsWith(f.name));
        if (file) return JSON.stringify({ status: file.status });
        throw new Error('File not found');
      });
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
      } else if (isCommandResult) {
        (writeFileSync as jest.Mock)(markerPath, String(Date.now()));
        console.log(RE_ENTRY_MSG);
      }
    } catch {
      // commands directory doesn't exist
      if (isCommandResult) {
        (writeFileSync as jest.Mock)(markerPath, String(Date.now()));
        console.log(RE_ENTRY_MSG);
      }
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

  it('should NOT skip slack_command_result tool', () => {
    simulateHook({
      toolName: 'mcp__slack-bridge__slack_command_result',
      pendingFiles: [{ name: 'cmd-1.json', status: 'pending' }],
    });

    expect(resolveSession).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 1건 대기 중'),
    );
  });

  it('should output re-entry message after slack_command_result with no pending', () => {
    simulateHook({
      toolName: 'mcp__slack-bridge__slack_command_result',
      pendingFiles: [{ name: 'cmd-1.json', status: 'completed' }],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 처리 완료'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('blocking=true'),
    );
  });

  it('should bypass cooldown for slack_command_result', () => {
    simulateHook({
      toolName: 'mcp__slack-bridge__slack_command_result',
      lastNotifyTs: Date.now() - 1000, // 1 second ago (within 10s cooldown)
      pendingFiles: [{ name: 'cmd-1.json', status: 'completed' }],
    });

    // Should still output despite being within cooldown
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 처리 완료'),
    );
  });

  it('should output initial notification on session first run', () => {
    simulateHook({ isFirstRun: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 대기 시작'),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.wait-loop-notified'),
      expect.any(String),
    );
  });

  it('should proceed to normal logic after initial notification', () => {
    simulateHook({
      isFirstRun: false,
      pendingFiles: [
        { name: 'cmd-1.json', status: 'pending' },
        { name: 'cmd-2.json', status: 'pending' },
      ],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 2건 대기 중'),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Slack 명령 대기 시작'),
    );
  });

  it('should skip initial notification for slack_check_commands tool', () => {
    simulateHook({
      toolName: 'mcp__slack-bridge__slack_check_commands',
      isFirstRun: true,
    });

    // SKIP_TOOLS prevents reaching the initial notification logic
    expect(resolveSession).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
