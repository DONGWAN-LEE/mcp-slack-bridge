import { SessionService } from './session.service';
import { EnvironmentDetector } from './environment.detector';
import * as fileUtils from '@app/shared/utils/file.utils';

jest.mock('@app/shared/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
  ensureDir: jest.fn(),
  touchFile: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

describe('SessionService', () => {
  let service: SessionService;
  let envDetector: EnvironmentDetector;
  const mockSessionCfg = { heartbeatMs: 30000, maxActive: 10, timeoutMs: 3600000, staleMs: 300000 };
  const mockPathsCfg = { workingDir: '/test/project', stateDir: './state' };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    envDetector = new EnvironmentDetector();
    jest.spyOn(envDetector, 'detect').mockReturnValue({
      terminal: 'vscode',
      pid: 12345,
      shell: 'bash',
      displayName: 'VS Code (PID 12345)',
    });

    service = new SessionService(
      envDetector,
      mockSessionCfg as any,
      mockPathsCfg as any,
    );

    // Spy on private detectGitBranch to avoid real execSync calls
    jest.spyOn(service as any, 'detectGitBranch').mockReturnValue('main');

    // Suppress console.error in tests
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    service.terminateSession();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('createSession', () => {
    beforeEach(() => {
      (service as any).detectGitBranch.mockReturnValue('feature/test');
    });

    it('should create session with correct UUID and meta', () => {
      const session = service.createSession('/test/project');

      expect(session.sessionId).toBe('test-uuid-1234');
      expect(session.status).toBe('active');
      expect(session.projectPath).toBe('/test/project');
      expect(session.projectName).toBe('project');
      expect(session.gitBranch).toBe('feature/test');
      expect(session.environment.terminal).toBe('vscode');
    });

    it('should create session directory structure', () => {
      service.createSession('/test/project');

      expect(fileUtils.ensureDir).toHaveBeenCalledWith(
        expect.stringContaining('test-uuid-1234'),
      );
      expect(fileUtils.ensureDir).toHaveBeenCalledWith(
        expect.stringContaining('questions'),
      );
      expect(fileUtils.ensureDir).toHaveBeenCalledWith(
        expect.stringContaining('responses'),
      );
      expect(fileUtils.ensureDir).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
      );
    });

    it('should write meta.json via atomicWriteJson', () => {
      service.createSession('/test/project');

      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('meta.json'),
        expect.objectContaining({
          sessionId: 'test-uuid-1234',
          status: 'active',
        }),
      );
    });

    it('should create initial heartbeat file', () => {
      service.createSession('/test/project');

      expect(fileUtils.touchFile).toHaveBeenCalledWith(
        expect.stringContaining('heartbeat'),
      );
    });

    it('should accept optional claudeSessionId', () => {
      const session = service.createSession('/test/project', 'claude-abc');

      expect(session.claudeSessionId).toBe('claude-abc');
    });
  });

  describe('heartbeat', () => {
    it('should call touchFile periodically', () => {
      service.createSession('/test/project');

      const initialTouchCalls = (fileUtils.touchFile as jest.Mock).mock.calls.length;

      jest.advanceTimersByTime(30000);

      expect((fileUtils.touchFile as jest.Mock).mock.calls.length).toBeGreaterThan(
        initialTouchCalls,
      );
    });

    it('should update meta.json lastActiveAt on heartbeat', () => {
      const session = service.createSession('/test/project');

      // readJsonFile returns existing meta (simulating file on disk)
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue({ ...session });

      const initialWriteCalls = (fileUtils.atomicWriteJson as jest.Mock).mock.calls.length;

      jest.advanceTimersByTime(30000);

      expect((fileUtils.atomicWriteJson as jest.Mock).mock.calls.length).toBeGreaterThan(
        initialWriteCalls,
      );
    });

    it('should preserve Bot-written fields like slackThreadTs on heartbeat', () => {
      const session = service.createSession('/test/project');

      // Simulate Bot having written slackThreadTs to meta.json
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue({
        ...session,
        slackThreadTs: '1234.5678',
      });

      jest.advanceTimersByTime(30000);

      const writeCalls = (fileUtils.atomicWriteJson as jest.Mock).mock.calls;
      const lastMeta = writeCalls[writeCalls.length - 1][1];
      expect(lastMeta.slackThreadTs).toBe('1234.5678');
      expect(lastMeta.status).toBe('active');
    });
  });

  describe('terminateSession', () => {
    it('should update status to terminated', () => {
      const session = service.createSession('/test/project');

      // readJsonFile returns existing meta (simulating file on disk)
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue({ ...session });

      service.terminateSession();

      const lastWriteCall = (fileUtils.atomicWriteJson as jest.Mock).mock.calls;
      const lastMeta = lastWriteCall[lastWriteCall.length - 1][1];
      expect(lastMeta.status).toBe('terminated');
    });

    it('should stop heartbeat timer', () => {
      service.createSession('/test/project');
      service.terminateSession();

      (fileUtils.touchFile as jest.Mock).mockClear();
      jest.advanceTimersByTime(60000);

      expect(fileUtils.touchFile).not.toHaveBeenCalled();
    });

    it('should set currentSession to null', () => {
      service.createSession('/test/project');

      service.terminateSession();

      expect(service.getSession()).toBeNull();
    });

    it('should be safe to call when no session exists', () => {
      expect(() => service.terminateSession()).not.toThrow();
    });
  });

  describe('getSession', () => {
    it('should return null when no session', () => {
      expect(service.getSession()).toBeNull();
    });

    it('should return current session after creation', () => {
      service.createSession('/test/project');

      const session = service.getSession();
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('test-uuid-1234');
    });
  });

  describe('git branch detection', () => {
    it('should detect git branch', () => {
      (service as any).detectGitBranch.mockReturnValue('feature/auth');

      const session = service.createSession('/test/project');
      expect(session.gitBranch).toBe('feature/auth');
    });

    it('should return undefined when git detection fails', () => {
      (service as any).detectGitBranch.mockReturnValue(undefined);

      const session = service.createSession('/test/project');
      expect(session.gitBranch).toBeUndefined();
    });
  });

  describe('lifecycle hooks', () => {
    it('onModuleInit should create session', async () => {
      await service.onModuleInit();

      expect(service.getSession()).not.toBeNull();
    });

    it('onModuleDestroy should terminate session', async () => {
      service.createSession('/test/project');

      await service.onModuleDestroy();

      expect(service.getSession()).toBeNull();
    });
  });
});
