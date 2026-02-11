import { resolveSession } from '../utils/session-resolver';
import * as fileUtils from '../../libs/shared/src/utils/file.utils';
import { readdirSync } from 'fs';

jest.mock('fs', () => ({
  readdirSync: jest.fn(),
}));

jest.mock('../../libs/shared/src/utils/file.utils', () => ({
  readJsonFile: jest.fn(),
}));

describe('resolveSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return null when .current-session does not exist and no sessions', () => {
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue(null);
    (readdirSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return null when .current-session has no sessionId and no sessions', () => {
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue({});
    (readdirSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return null when session meta does not exist and no fallback', () => {
    (fileUtils.readJsonFile as jest.Mock)
      .mockReturnValueOnce({ sessionId: 'abc-123', projectPath: '/test', createdAt: '2026-01-01', pid: 1 })
      .mockReturnValueOnce(null);
    (readdirSync as jest.Mock).mockReturnValue([]);

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return null when session is terminated and no fallback', () => {
    (fileUtils.readJsonFile as jest.Mock)
      .mockReturnValueOnce({ sessionId: 'abc-123', projectPath: '/test', createdAt: '2026-01-01', pid: 1 })
      .mockReturnValueOnce({ sessionId: 'abc-123', status: 'terminated' });
    (readdirSync as jest.Mock).mockReturnValue([]);

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return session info when active session found', () => {
    (fileUtils.readJsonFile as jest.Mock)
      .mockReturnValueOnce({ sessionId: 'abc-123', projectPath: '/test', createdAt: '2026-01-01', pid: 1 })
      .mockReturnValueOnce({ sessionId: 'abc-123', status: 'active' });

    const result = resolveSession('./state');
    expect(result).toEqual({
      sessionId: 'abc-123',
      sessionDir: expect.stringContaining('abc-123'),
    });
  });

  it('should work with idle/waiting status', () => {
    (fileUtils.readJsonFile as jest.Mock)
      .mockReturnValueOnce({ sessionId: 'abc-123', projectPath: '/test', createdAt: '2026-01-01', pid: 1 })
      .mockReturnValueOnce({ sessionId: 'abc-123', status: 'waiting' });

    const result = resolveSession('./state');
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('abc-123');
  });

  describe('fallback scanning', () => {
    it('should find active session by scanning when .current-session is missing', () => {
      // .current-session returns null
      (fileUtils.readJsonFile as jest.Mock)
        .mockReturnValueOnce(null)
        // fallback scan: meta.json for session-aaa
        .mockReturnValueOnce({
          sessionId: 'session-aaa',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-01T01:00:00Z',
        });

      (readdirSync as jest.Mock).mockReturnValue([
        { name: 'session-aaa', isDirectory: () => true },
      ]);

      const result = resolveSession('./state');
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('session-aaa');
    });

    it('should pick the most recently active session among multiple', () => {
      // .current-session returns null
      (fileUtils.readJsonFile as jest.Mock)
        .mockReturnValueOnce(null)
        // fallback scan: meta for older session
        .mockReturnValueOnce({
          sessionId: 'session-old',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-01T01:00:00Z',
        })
        // fallback scan: meta for newer session
        .mockReturnValueOnce({
          sessionId: 'session-new',
          status: 'active',
          createdAt: '2026-01-01T02:00:00Z',
          lastActiveAt: '2026-01-01T03:00:00Z',
        })
        // fallback scan: meta for terminated session
        .mockReturnValueOnce({
          sessionId: 'session-dead',
          status: 'terminated',
          createdAt: '2026-01-01T04:00:00Z',
          lastActiveAt: '2026-01-01T05:00:00Z',
        });

      (readdirSync as jest.Mock).mockReturnValue([
        { name: 'session-old', isDirectory: () => true },
        { name: 'session-new', isDirectory: () => true },
        { name: 'session-dead', isDirectory: () => true },
      ]);

      const result = resolveSession('./state');
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('session-new');
    });

    it('should return null when .current-session is missing and no active sessions exist', () => {
      (fileUtils.readJsonFile as jest.Mock)
        .mockReturnValueOnce(null)
        // all sessions terminated
        .mockReturnValueOnce({ sessionId: 'x', status: 'terminated' });

      (readdirSync as jest.Mock).mockReturnValue([
        { name: 'session-x', isDirectory: () => true },
      ]);

      const result = resolveSession('./state');
      expect(result).toBeNull();
    });
  });
});
