jest.mock('@app/shared/utils/file.utils', () => ({
  readJsonFile: jest.fn(),
  atomicWriteJson: jest.fn(),
}));

// Only mock specific fs functions used by PollerService, not the entire module
const mockReaddirSync = jest.fn();
const mockStatSync = jest.fn();
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readdirSync: (...args: any[]) => mockReaddirSync(...args),
    statSync: (...args: any[]) => mockStatSync(...args),
  };
});

import { PollerService } from './poller.service';
import * as fileUtils from '@app/shared/utils/file.utils';

describe('PollerService', () => {
  let service: PollerService;
  let slackService: any;

  const pathsCfg = { stateDir: './state', workingDir: '.' };
  const pollingCfg = { intervalMs: 2000 };
  const sessionCfg = {
    maxActive: 10,
    timeoutMs: 3600000,
    heartbeatMs: 30000,
    staleMs: 300000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    slackService = {
      getChannelId: jest.fn().mockReturnValue('C12345'),
      postMessage: jest.fn().mockResolvedValue({ ts: '111.222' }),
      updateMessage: jest.fn().mockResolvedValue(undefined),
    };

    service = new PollerService(
      slackService,
      pathsCfg as any,
      pollingCfg as any,
      sessionCfg as any,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('should start polling on init with setInterval', () => {
    const spy = jest.spyOn(global, 'setInterval');
    service.onModuleInit();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 2000);
    spy.mockRestore();
  });

  it('should clear interval on destroy', () => {
    service.onModuleInit();
    const spy = jest.spyOn(global, 'clearInterval');
    service.onModuleDestroy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should detect pending question and post to Slack', async () => {
    mockReaddirSync.mockImplementation((dir: string, opts?: any) => {
      if (dir.endsWith('sessions')) {
        if (opts?.withFileTypes) {
          return [{ name: 'sess-1', isDirectory: () => true }];
        }
        return ['sess-1'];
      }
      if (dir.includes('questions')) return ['q-001.json'];
      if (dir.includes('notifications')) return [];
      return [];
    });

    const meta = {
      sessionId: 'sess-1',
      status: 'active',
      createdAt: new Date().toISOString(),
      environment: { terminal: 'vscode', displayName: 'VS Code' },
      projectName: 'test',
      projectPath: '/test',
      slackThreadTs: '100.200',
    };

    const question = {
      questionId: 'q-001',
      sessionId: 'sess-1',
      question: 'Deploy?',
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeout: 1800000,
    };

    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) return meta;
      if (path.includes('q-001.json')) return question;
      return null;
    });

    mockStatSync.mockReturnValue({ mtimeMs: Date.now() });

    service.onModuleInit();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(slackService.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C12345',
        thread_ts: '100.200',
      }),
    );
  });

  it('should create session thread if slackThreadTs is missing', async () => {
    mockReaddirSync.mockImplementation((dir: string, opts?: any) => {
      if (dir.endsWith('sessions')) {
        if (opts?.withFileTypes) {
          return [{ name: 'sess-2', isDirectory: () => true }];
        }
        return ['sess-2'];
      }
      if (dir.includes('questions')) return ['q-002.json'];
      if (dir.includes('notifications')) return [];
      return [];
    });

    const meta = {
      sessionId: 'sess-2',
      status: 'active',
      createdAt: new Date().toISOString(),
      environment: { terminal: 'vscode', displayName: 'VS Code' },
      projectName: 'test',
      projectPath: '/test',
    };

    const question = {
      questionId: 'q-002',
      sessionId: 'sess-2',
      question: 'Continue?',
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeout: 1800000,
    };

    let callCount = 0;
    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) {
        callCount++;
        if (callCount > 1) return { ...meta, slackThreadTs: '111.222' };
        return meta;
      }
      if (path.includes('q-002.json')) return question;
      return null;
    });

    mockStatSync.mockReturnValue({ mtimeMs: Date.now() });

    service.onModuleInit();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(slackService.postMessage).toHaveBeenCalledTimes(2);
    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('meta.json'),
      expect.objectContaining({ slackThreadTs: '111.222' }),
    );
  });

  it('should not re-send known questions (dedup)', async () => {
    mockReaddirSync.mockImplementation((dir: string, opts?: any) => {
      if (dir.endsWith('sessions')) {
        if (opts?.withFileTypes) {
          return [{ name: 'sess-3', isDirectory: () => true }];
        }
        return ['sess-3'];
      }
      if (dir.includes('questions')) return ['q-003.json'];
      if (dir.includes('notifications')) return [];
      return [];
    });

    const meta = {
      sessionId: 'sess-3',
      status: 'active',
      createdAt: new Date().toISOString(),
      environment: { terminal: 'vscode', displayName: 'VS Code' },
      projectName: 'test',
      projectPath: '/test',
      slackThreadTs: '100.200',
    };

    const question = {
      questionId: 'q-003',
      sessionId: 'sess-3',
      question: 'Proceed?',
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeout: 1800000,
    };

    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) return meta;
      if (path.includes('q-003.json')) return question;
      return null;
    });

    mockStatSync.mockReturnValue({ mtimeMs: Date.now() });

    service.onModuleInit();

    // First poll
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Second poll
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(slackService.postMessage).toHaveBeenCalledTimes(1);
  });

  it('should terminate stale sessions', async () => {
    mockReaddirSync.mockImplementation((dir: string, opts?: any) => {
      if (dir.endsWith('sessions')) {
        if (opts?.withFileTypes) {
          return [{ name: 'sess-stale', isDirectory: () => true }];
        }
        return ['sess-stale'];
      }
      return [];
    });

    const meta = {
      sessionId: 'sess-stale',
      status: 'active',
      createdAt: new Date().toISOString(),
      environment: { terminal: 'vscode', displayName: 'VS Code' },
      projectName: 'test',
      projectPath: '/test',
    };

    (fileUtils.readJsonFile as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('meta.json')) return meta;
      return null;
    });

    mockStatSync.mockReturnValue({
      mtimeMs: Date.now() - 400000,
    });

    service.onModuleInit();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('meta.json'),
      expect.objectContaining({ status: 'terminated' }),
    );
  });
});
