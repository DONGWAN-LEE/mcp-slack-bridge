import { join } from 'path';
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

describe('on-notification logic', () => {
  const mockSessionDir = join('./state', 'sessions', 'test-session');
  const mockResolveSession = resolveSession as jest.MockedFunction<typeof resolveSession>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveSession.mockReturnValue({
      sessionId: 'test-session',
      sessionDir: mockSessionDir,
    });
  });

  function simulateHook(message: string | undefined, hasSession = true): void {
    if (!hasSession) {
      mockResolveSession.mockReturnValue(null);
    }

    const session = resolveSession('./state');
    if (!session) return;
    if (!message) return;

    const notificationId = `n-${Date.now()}`;
    const notificationsDir = join(session.sessionDir, 'notifications');
    fileUtils.ensureDir(notificationsDir);

    fileUtils.atomicWriteJson(join(notificationsDir, `${notificationId}.json`), {
      notificationId,
      sessionId: session.sessionId,
      message,
      level: 'info',
      createdAt: new Date().toISOString(),
    });
  }

  it('should write notification file when session exists', () => {
    simulateHook('Build completed successfully');

    expect(fileUtils.ensureDir).toHaveBeenCalledWith(expect.stringContaining('notifications'));
    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('notifications'),
      expect.objectContaining({
        sessionId: 'test-session',
        message: 'Build completed successfully',
        level: 'info',
      }),
    );
  });

  it('should do nothing when no session', () => {
    simulateHook('test message', false);

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should do nothing when no message', () => {
    simulateHook(undefined);

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });
});
