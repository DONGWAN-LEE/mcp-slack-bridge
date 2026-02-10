import { resolveSession } from '../utils/session-resolver';
import * as fileUtils from '../../libs/shared/src/utils/file.utils';

jest.mock('../../libs/shared/src/utils/file.utils', () => ({
  readJsonFile: jest.fn(),
}));

describe('resolveSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return null when .current-session does not exist', () => {
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue(null);

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return null when .current-session has no sessionId', () => {
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue({});

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return null when session meta does not exist', () => {
    (fileUtils.readJsonFile as jest.Mock)
      .mockReturnValueOnce({ sessionId: 'abc-123', projectPath: '/test', createdAt: '2026-01-01', pid: 1 })
      .mockReturnValueOnce(null);

    const result = resolveSession('./state');
    expect(result).toBeNull();
  });

  it('should return null when session is terminated', () => {
    (fileUtils.readJsonFile as jest.Mock)
      .mockReturnValueOnce({ sessionId: 'abc-123', projectPath: '/test', createdAt: '2026-01-01', pid: 1 })
      .mockReturnValueOnce({ sessionId: 'abc-123', status: 'terminated' });

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
});
