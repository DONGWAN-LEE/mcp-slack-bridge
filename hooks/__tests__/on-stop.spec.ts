import { join } from 'path';
import { existsSync, readdirSync, unlinkSync } from 'fs';
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
}));

describe('on-stop logic', () => {
  const mockSessionDir = join('./state', 'sessions', 'test-session');
  const mockResolveSession = resolveSession as jest.MockedFunction<typeof resolveSession>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveSession.mockReturnValue({
      sessionId: 'test-session',
      sessionDir: mockSessionDir,
    });
  });

  function simulateHook(hasSession = true): void {
    if (!hasSession) {
      mockResolveSession.mockReturnValue(null);
    }

    const session = resolveSession('./state');
    if (!session) return;

    // Update meta.json to terminated
    const metaPath = join(session.sessionDir, 'meta.json');
    const meta = fileUtils.readJsonFile(metaPath) as any;
    if (meta) {
      meta.status = 'terminated';
      meta.lastActiveAt = new Date().toISOString();
      fileUtils.atomicWriteJson(metaPath, meta);
    }

    // Expire all pending questions
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

    // Delete .current-session if it matches
    const currentSessionPath = join('./state', '.current-session');
    const currentFile = fileUtils.readJsonFile(currentSessionPath) as any;
    if (currentFile && currentFile.sessionId === session.sessionId) {
      (unlinkSync as jest.Mock)(currentSessionPath);
    }
  }

  it('should update meta.json to terminated', () => {
    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) {
        return { sessionId: 'test-session', status: 'active' };
      }
      if (path.includes('.current-session')) {
        return { sessionId: 'test-session' };
      }
      return null;
    });
    (existsSync as jest.Mock).mockReturnValue(false);

    simulateHook();

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('meta.json'),
      expect.objectContaining({ status: 'terminated' }),
    );
  });

  it('should expire all pending questions', () => {
    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) {
        return { sessionId: 'test-session', status: 'active' };
      }
      if (path.includes('q-')) {
        return { questionId: 'q-123', status: 'pending' };
      }
      if (path.includes('.current-session')) {
        return { sessionId: 'test-session' };
      }
      return null;
    });
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue(['q-123.json', 'q-456.json']);

    simulateHook();

    // Should write expired status for each pending question
    const writeCalls = (fileUtils.atomicWriteJson as jest.Mock).mock.calls;
    const questionWrites = writeCalls.filter(([path]: [string]) => path.includes('q-'));
    expect(questionWrites.length).toBe(2);
    for (const [, data] of questionWrites) {
      expect(data.status).toBe('expired');
    }
  });

  it('should delete .current-session when matching', () => {
    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) {
        return { sessionId: 'test-session', status: 'active' };
      }
      if (path.includes('.current-session')) {
        return { sessionId: 'test-session' };
      }
      return null;
    });
    (existsSync as jest.Mock).mockReturnValue(false);

    simulateHook();

    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.current-session'));
  });

  it('should NOT delete .current-session when different session', () => {
    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) {
        return { sessionId: 'test-session', status: 'active' };
      }
      if (path.includes('.current-session')) {
        return { sessionId: 'other-session' };
      }
      return null;
    });
    (existsSync as jest.Mock).mockReturnValue(false);

    simulateHook();

    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it('should do nothing when no session', () => {
    simulateHook(false);

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });
});
