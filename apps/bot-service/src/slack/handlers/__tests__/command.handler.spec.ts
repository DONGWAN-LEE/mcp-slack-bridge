import { CommandHandler } from '../command.handler';
import { readJsonFile, atomicWriteJson } from '@app/shared/utils/file.utils';
import { readdirSync } from 'fs';

jest.mock('@app/shared/utils/file.utils');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readdirSync: jest.fn(),
}));

const mockReadJsonFile = readJsonFile as jest.MockedFunction<typeof readJsonFile>;
const mockAtomicWriteJson = atomicWriteJson as jest.MockedFunction<typeof atomicWriteJson>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;

describe('CommandHandler', () => {
  let handler: CommandHandler;
  let mockSlackService: any;
  let mockExecutorService: any;
  let mockQueueService: any;
  let registeredCommands: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    registeredCommands = new Map();

    mockSlackService = {
      getApp: jest.fn().mockReturnValue({
        command: jest.fn((name: string, fn: Function) => {
          registeredCommands.set(name, fn);
        }),
      }),
      isAllowedUser: jest.fn().mockReturnValue(true),
      isAllowedChannel: jest.fn().mockReturnValue(true),
      getChannelId: jest.fn().mockReturnValue('C123'),
      postMessage: jest.fn().mockResolvedValue({ ts: '123' }),
    };

    mockExecutorService = {
      validatePrompt: jest.fn().mockReturnValue({ valid: true }),
      needsConfirmation: jest.fn().mockReturnValue(null),
      submitJob: jest.fn().mockResolvedValue({ id: 'job-123456', prompt: 'test', status: 'queued' }),
      cancelJobById: jest.fn(),
    };

    mockQueueService = {
      getRunningJobs: jest.fn().mockResolvedValue([]),
      getQueuedJobs: jest.fn().mockResolvedValue([]),
    };

    handler = new CommandHandler(
      mockSlackService,
      mockExecutorService,
      mockQueueService,
      { stateDir: './state' } as any,
    );

    handler.onModuleInit();
  });

  describe('command registration', () => {
    it('should register all 5 commands', () => {
      expect(registeredCommands.has('/claude')).toBe(true);
      expect(registeredCommands.has('/claude-sessions')).toBe(true);
      expect(registeredCommands.has('/claude-inject')).toBe(true);
      expect(registeredCommands.has('/claude-status')).toBe(true);
      expect(registeredCommands.has('/claude-cancel')).toBe(true);
    });
  });

  describe('parseMode (static)', () => {
    it('should parse plan mode', () => {
      const result = CommandHandler.parseMode('plan 아키텍처를 설계해줘');
      expect(result.mode).toBe('plan');
      expect(result.prompt).toBe('아키텍처를 설계해줘');
    });

    it('should parse brainstorm mode', () => {
      const result = CommandHandler.parseMode('brainstorm 새로운 기능 아이디어');
      expect(result.mode).toBe('brainstorm');
      expect(result.prompt).toBe('새로운 기능 아이디어');
    });

    it('should parse analyze mode', () => {
      const result = CommandHandler.parseMode('analyze 코드 분석해줘');
      expect(result.mode).toBe('analyze');
      expect(result.prompt).toBe('코드 분석해줘');
    });

    it('should parse review mode', () => {
      const result = CommandHandler.parseMode('review PR 검토해줘');
      expect(result.mode).toBe('review');
      expect(result.prompt).toBe('PR 검토해줘');
    });

    it('should default mode for regular prompt', () => {
      const result = CommandHandler.parseMode('add email column');
      expect(result.mode).toBe('default');
      expect(result.prompt).toBe('add email column');
    });

    it('should be case insensitive for mode', () => {
      const result = CommandHandler.parseMode('Plan 아키텍처를 설계해줘');
      expect(result.mode).toBe('plan');
      expect(result.prompt).toBe('아키텍처를 설계해줘');
    });

    it('should return empty prompt when only mode word', () => {
      const result = CommandHandler.parseMode('plan');
      expect(result.mode).toBe('plan');
      expect(result.prompt).toBe('');
    });
  });

  describe('/claude', () => {
    it('should reject unauthorized users', async () => {
      mockSlackService.isAllowedUser.mockReturnValue(false);
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'UBAD', text: 'test' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('권한') }),
      );
    });

    it('should reject unauthorized channel', async () => {
      mockSlackService.isAllowedChannel.mockReturnValue(false);
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'U123', text: 'test', channel_id: 'C_BAD' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('채널') }),
      );
      expect(mockExecutorService.submitJob).not.toHaveBeenCalled();
    });

    it('should show usage for empty prompt', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'U123', text: '' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('사용법') }),
      );
    });

    it('should show warning for mode-only input', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'U123', text: 'plan' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('프롬프트를 입력') }),
      );
    });

    it('should reject invalid prompt', async () => {
      mockExecutorService.validatePrompt.mockReturnValue({ valid: false, reason: 'blocked' });
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'U123', text: 'rm -rf /' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('실행 불가') }),
      );
    });

    it('should submit valid job with default mode', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'U123', text: 'add email column', channel_id: 'C123' }, ack, respond });

      expect(mockExecutorService.submitJob).toHaveBeenCalledWith(
        'add email column',
        'U123',
        { channel: 'C123', mode: 'default' },
      );
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('큐에 추가') }),
      );
    });

    it('should submit job with plan mode', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude')!;
      await fn({ command: { user_id: 'U123', text: 'plan 아키텍처 설계해줘', channel_id: 'C123' }, ack, respond });

      expect(mockExecutorService.submitJob).toHaveBeenCalledWith(
        '아키텍처 설계해줘',
        'U123',
        { channel: 'C123', mode: 'plan' },
      );
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('Plan Mode') }),
      );
    });
  });

  describe('/claude-sessions', () => {
    it('should list active sessions', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'session-1', isDirectory: () => true } as any,
      ] as any);
      mockReadJsonFile.mockReturnValue({
        sessionId: 'session-1',
        status: 'active',
        environment: { terminal: 'vscode', displayName: 'VS Code' },
        projectName: 'test',
        createdAt: new Date().toISOString(),
      });

      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-sessions')!;
      await fn({ command: { user_id: 'U123' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'in_channel',
          blocks: expect.any(Array),
        }),
      );
    });

    it('should show empty message when no sessions', async () => {
      mockReaddirSync.mockReturnValue([]);

      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-sessions')!;
      await fn({ command: { user_id: 'U123' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('활성 세션'),
        }),
      );
    });
  });

  describe('/claude-inject', () => {
    it('should show usage for empty input', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-inject')!;
      await fn({ command: { user_id: 'U123', text: 'a1b2' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('사용법') }),
      );
    });

    it('should inject context to matching session', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'a1b2c3d4-full-id', isDirectory: () => true } as any,
      ] as any);
      mockReadJsonFile.mockReturnValue({
        sessionId: 'a1b2c3d4-full-id',
        status: 'active',
        environment: { terminal: 'vscode', displayName: 'VS Code' },
      });

      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-inject')!;
      await fn({
        command: { user_id: 'U123', text: 'a1b2 use OAuth2 for auth' },
        ack,
        respond,
      });

      expect(mockAtomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('inject-'),
        expect.objectContaining({
          type: 'context_injection',
          message: 'use OAuth2 for auth',
        }),
      );
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('주입'),
          response_type: 'in_channel',
        }),
      );
    });

    it('should reject when no matching session', async () => {
      mockReaddirSync.mockReturnValue([]);

      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-inject')!;
      await fn({
        command: { user_id: 'U123', text: 'zzzz some message' },
        ack,
        respond,
      });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('없거나') }),
      );
    });
  });

  describe('/claude-status', () => {
    it('should show empty queue', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-status')!;
      await fn({ command: { user_id: 'U123' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.any(Array),
        }),
      );
    });
  });

  describe('/claude-cancel', () => {
    it('should cancel running job', async () => {
      mockQueueService.getRunningJobs.mockResolvedValue([
        { id: 'job-123', prompt: 'test', status: 'running' },
      ]);
      mockExecutorService.cancelJobById.mockResolvedValue({
        id: 'job-123',
        status: 'cancelled',
      });

      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-cancel')!;
      await fn({ command: { user_id: 'U123', text: '' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('취소'),
          response_type: 'in_channel',
        }),
      );
    });

    it('should show message when no running jobs', async () => {
      const respond = jest.fn();
      const ack = jest.fn();

      const fn = registeredCommands.get('/claude-cancel')!;
      await fn({ command: { user_id: 'U123', text: '' }, ack, respond });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('실행 중인 작업이 없습니다'),
        }),
      );
    });
  });
});
