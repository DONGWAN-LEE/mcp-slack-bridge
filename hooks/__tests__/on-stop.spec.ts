import { join } from 'path';
import { existsSync, readdirSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import * as fileUtils from '../../libs/shared/src/utils/file.utils';
import { resolveSession } from '../utils/session-resolver';

jest.mock('../../libs/shared/src/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
  ensureDir: jest.fn(),
}));

jest.mock('../utils/session-resolver', () => ({
  resolveSession: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const MAX_CONSECUTIVE_BLOCKS = 5;
const BLOCK_REASON =
  '[Slack 명령 대기 필요] slack_check_commands 도구를 blocking=true로 호출하여 Slack 명령 대기를 시작하세요. ' +
  '타임아웃 시 즉시 다시 호출하여 대기를 계속하세요.';

describe('on-stop logic', () => {
  const stateDir = './state';
  const mockSessionDir = join(stateDir, 'sessions', 'test-session');
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

  function readBlockCount(sessionDir: string): number {
    const countPath = join(sessionDir, '.stop-block-count');
    try {
      return parseInt((readFileSync as jest.Mock)(countPath, 'utf8'), 10) || 0;
    } catch {
      return 0;
    }
  }

  function simulateHook(options: {
    hasSession?: boolean;
    noLoopFlag?: boolean;
    blockCount?: number;
    hasMeta?: boolean;
    hasQuestions?: boolean;
    currentSessionMatches?: boolean;
  } = {}): string | null {
    const {
      hasSession = true,
      noLoopFlag = false,
      blockCount = 0,
      hasMeta = true,
      hasQuestions = false,
      currentSessionMatches = true,
    } = options;

    if (!hasSession) {
      mockResolveSession.mockReturnValue(null);
    }

    const session = resolveSession(stateDir);
    if (!session) return null;

    // Setup existsSync
    (existsSync as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('.no-wait-loop')) return noLoopFlag;
      if (path.includes('questions')) return hasQuestions;
      return false;
    });

    // Setup readFileSync for block count
    (readFileSync as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('.stop-block-count')) {
        if (blockCount > 0) return String(blockCount);
        throw new Error('ENOENT');
      }
      throw new Error('ENOENT');
    });

    // Setup for cleanup operations
    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) {
        return hasMeta ? { sessionId: 'test-session', status: 'active' } : null;
      }
      if (path.includes('.current-session')) {
        return currentSessionMatches
          ? { sessionId: 'test-session' }
          : { sessionId: 'other-session' };
      }
      if (path.includes('q-')) {
        return { questionId: 'q-123', status: 'pending' };
      }
      return null;
    });

    if (hasQuestions) {
      (readdirSync as jest.Mock).mockReturnValue(['q-123.json']);
    } else {
      (readdirSync as jest.Mock).mockReturnValue([]);
    }

    // Check no-loop flag
    const noLoopFlagPath = join(session.sessionDir, '.no-wait-loop');
    if ((existsSync as jest.Mock)(noLoopFlagPath)) {
      try {
        (unlinkSync as jest.Mock)(noLoopFlagPath);
      } catch {
        // ignore
      }
      // Cleanup session
      performCleanup(session);
      return 'allowed-exit-flag';
    }

    // Circuit breaker
    const count = readBlockCount(session.sessionDir);
    if (count >= MAX_CONSECUTIVE_BLOCKS) {
      (writeFileSync as jest.Mock)(join(session.sessionDir, '.stop-block-count'), '0');
      performCleanup(session);
      return 'allowed-circuit-breaker';
    }

    // Block
    (writeFileSync as jest.Mock)(
      join(session.sessionDir, '.stop-block-count'),
      String(count + 1),
    );

    const decision = { decision: 'block', reason: BLOCK_REASON };
    console.log(JSON.stringify(decision));
    return 'blocked';
  }

  function performCleanup(session: { sessionId: string; sessionDir: string }): void {
    const metaPath = join(session.sessionDir, 'meta.json');
    const meta = fileUtils.readJsonFile(metaPath) as any;
    if (meta) {
      meta.status = 'terminated';
      meta.lastActiveAt = new Date().toISOString();
      fileUtils.atomicWriteJson(metaPath, meta);
    }

    const questionsDir = join(session.sessionDir, 'questions');
    if ((existsSync as jest.Mock)(questionsDir)) {
      const files = (readdirSync as jest.Mock)(questionsDir).filter(
        (f: string) => f.startsWith('q-') && f.endsWith('.json'),
      );
      for (const file of files) {
        const qPath = join(questionsDir, file);
        const q = fileUtils.readJsonFile(qPath) as any;
        if (q && q.status === 'pending') {
          q.status = 'expired';
          fileUtils.atomicWriteJson(qPath, q);
        }
      }
    }

    const currentSessionPath = join(stateDir, '.current-session');
    const currentFile = fileUtils.readJsonFile(currentSessionPath) as any;
    if (currentFile && currentFile.sessionId === session.sessionId) {
      (unlinkSync as jest.Mock)(currentSessionPath);
    }
  }

  it('should block Claude from stopping and output decision JSON', () => {
    const result = simulateHook();

    expect(result).toBe('blocked');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"decision":"block"'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('slack_check_commands'),
    );
  });

  it('should increment block count on each block', () => {
    simulateHook({ blockCount: 3 });

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.stop-block-count'),
      '4',
    );
  });

  it('should allow stop when circuit breaker triggers (count >= MAX)', () => {
    const result = simulateHook({ blockCount: MAX_CONSECUTIVE_BLOCKS });

    expect(result).toBe('allowed-circuit-breaker');
    // Should reset counter
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.stop-block-count'),
      '0',
    );
    // Should perform cleanup (terminate session)
    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('meta.json'),
      expect.objectContaining({ status: 'terminated' }),
    );
  });

  it('should allow stop when no-wait-loop flag exists', () => {
    const result = simulateHook({ noLoopFlag: true });

    expect(result).toBe('allowed-exit-flag');
    // Should delete the flag
    expect(unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('.no-wait-loop'),
    );
    // Should perform cleanup
    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('meta.json'),
      expect.objectContaining({ status: 'terminated' }),
    );
  });

  it('should do nothing when no session', () => {
    const result = simulateHook({ hasSession: false });

    expect(result).toBeNull();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should expire pending questions when allowing stop', () => {
    const result = simulateHook({
      noLoopFlag: true,
      hasQuestions: true,
    });

    expect(result).toBe('allowed-exit-flag');
    const writeCalls = (fileUtils.atomicWriteJson as jest.Mock).mock.calls;
    const questionWrites = writeCalls.filter(([path]: [string]) => path.includes('q-'));
    expect(questionWrites.length).toBe(1);
    for (const [, data] of questionWrites) {
      expect(data.status).toBe('expired');
    }
  });

  it('should delete .current-session when matching on allowed stop', () => {
    simulateHook({ noLoopFlag: true, currentSessionMatches: true });

    expect(unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('.current-session'),
    );
  });

  it('should NOT delete .current-session when different session', () => {
    simulateHook({ noLoopFlag: true, currentSessionMatches: false });

    // unlinkSync should only be called for .no-wait-loop, not .current-session
    const calls = (unlinkSync as jest.Mock).mock.calls;
    const currentSessionCalls = calls.filter(([path]: [string]) =>
      path.includes('.current-session'),
    );
    expect(currentSessionCalls.length).toBe(0);
  });

  it('should NOT perform cleanup when blocking', () => {
    simulateHook({ blockCount: 0 });

    // atomicWriteJson should NOT be called (no session termination)
    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should handle blockCount at exactly MAX_CONSECUTIVE_BLOCKS', () => {
    const result = simulateHook({ blockCount: MAX_CONSECUTIVE_BLOCKS });

    expect(result).toBe('allowed-circuit-breaker');
  });

  it('should handle blockCount just below MAX_CONSECUTIVE_BLOCKS', () => {
    const result = simulateHook({ blockCount: MAX_CONSECUTIVE_BLOCKS - 1 });

    expect(result).toBe('blocked');
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.stop-block-count'),
      String(MAX_CONSECUTIVE_BLOCKS),
    );
  });

  it('should output valid JSON for decision', () => {
    simulateHook();

    const logCall = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(logCall);
    expect(parsed).toEqual({
      decision: 'block',
      reason: expect.stringContaining('slack_check_commands'),
    });
  });
});
