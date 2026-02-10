import { MentionHandler } from '../mention.handler';

describe('MentionHandler', () => {
  let handler: MentionHandler;
  let mockSlackService: any;
  let mockExecutorService: any;
  let mockQueueService: any;
  let registeredEvents: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    registeredEvents = new Map();

    mockSlackService = {
      getApp: jest.fn().mockReturnValue({
        event: jest.fn((name: string, fn: Function) => {
          registeredEvents.set(name, fn);
        }),
      }),
      isAllowedUser: jest.fn().mockReturnValue(true),
      getChannelId: jest.fn().mockReturnValue('C123'),
      postMessage: jest.fn().mockResolvedValue({ ts: '456' }),
    };

    mockExecutorService = {
      validatePrompt: jest.fn().mockReturnValue({ valid: true }),
      needsConfirmation: jest.fn().mockReturnValue(null),
      stopJobByThreadTs: jest.fn(),
      submitJob: jest.fn().mockResolvedValue({
        id: 'job-12345678',
        prompt: 'test',
        status: 'queued',
      }),
    };

    mockQueueService = {
      findJobByThreadTs: jest.fn(),
      getRunningJobByThreadTs: jest.fn(),
    };

    handler = new MentionHandler(
      mockSlackService,
      mockExecutorService,
      mockQueueService,
    );

    handler.onModuleInit();
  });

  describe('event registration', () => {
    it('should register app_mention event', () => {
      expect(registeredEvents.has('app_mention')).toBe(true);
    });
  });

  describe('thread-only processing', () => {
    it('should ignore mentions outside of threads', async () => {
      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> stop',
        // no thread_ts
      });

      expect(mockExecutorService.stopJobByThreadTs).not.toHaveBeenCalled();
      expect(mockSlackService.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('stop command', () => {
    it('should stop a running job', async () => {
      mockExecutorService.stopJobByThreadTs.mockResolvedValue({
        id: 'job-12345678',
        prompt: 'test prompt',
        status: 'stopped',
        requestedBy: 'U123',
      });

      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> stop',
        thread_ts: 'ts-123',
      });

      expect(mockExecutorService.stopJobByThreadTs).toHaveBeenCalledWith('ts-123');
      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: 'ts-123',
          text: expect.stringContaining('중지'),
        }),
      );
    });

    it('should respond when no running job found', async () => {
      mockExecutorService.stopJobByThreadTs.mockResolvedValue(null);

      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> stop',
        thread_ts: 'ts-123',
      });

      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('실행 중인 작업이 없습니다'),
          thread_ts: 'ts-123',
        }),
      );
    });
  });

  describe('status command', () => {
    it('should show job status', async () => {
      mockQueueService.findJobByThreadTs.mockResolvedValue({
        id: 'job-12345678',
        prompt: 'test prompt',
        status: 'running',
        requestedBy: 'U123',
      });

      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> status',
        thread_ts: 'ts-123',
      });

      expect(mockQueueService.findJobByThreadTs).toHaveBeenCalledWith('ts-123');
      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: 'ts-123',
          text: expect.stringContaining('상태'),
        }),
      );
    });

    it('should respond when no job found', async () => {
      mockQueueService.findJobByThreadTs.mockResolvedValue(null);

      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> status',
        thread_ts: 'ts-123',
      });

      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('연결된 작업이 없습니다'),
          thread_ts: 'ts-123',
        }),
      );
    });
  });

  describe('new context', () => {
    it('should submit a new job in the same thread', async () => {
      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> 이 버그를 수정해줘',
        thread_ts: 'ts-123',
      });

      expect(mockExecutorService.submitJob).toHaveBeenCalledWith(
        '이 버그를 수정해줘',
        'U123',
        { thread_ts: 'ts-123', channel: 'C123' },
      );
      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('새 작업이 시작됩니다'),
          thread_ts: 'ts-123',
        }),
      );
    });

    it('should block prompts needing confirmation', async () => {
      mockExecutorService.needsConfirmation.mockReturnValue('git push');

      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> git push to origin',
        thread_ts: 'ts-123',
      });

      expect(mockExecutorService.submitJob).not.toHaveBeenCalled();
      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('주의가 필요한 명령'),
          thread_ts: 'ts-123',
        }),
      );
    });

    it('should reject invalid prompts', async () => {
      mockExecutorService.validatePrompt.mockReturnValue({
        valid: false,
        reason: 'blocked',
      });

      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID> rm -rf /',
        thread_ts: 'ts-123',
      });

      expect(mockExecutorService.submitJob).not.toHaveBeenCalled();
      expect(mockSlackService.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('실행 불가'),
          thread_ts: 'ts-123',
        }),
      );
    });
  });

  describe('unauthorized user', () => {
    it('should silently ignore unauthorized users', async () => {
      mockSlackService.isAllowedUser.mockReturnValue(false);

      await handler.handleMention({
        user: 'UBAD',
        channel: 'C123',
        text: '<@BOTID> stop',
        thread_ts: 'ts-123',
      });

      expect(mockExecutorService.stopJobByThreadTs).not.toHaveBeenCalled();
      expect(mockSlackService.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('strip mention', () => {
    it('should handle multiple mentions in text', async () => {
      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOT1> <@BOT2> stop',
        thread_ts: 'ts-123',
      });

      expect(mockExecutorService.stopJobByThreadTs).toHaveBeenCalledWith('ts-123');
    });

    it('should ignore empty text after stripping mention', async () => {
      await handler.handleMention({
        user: 'U123',
        channel: 'C123',
        text: '<@BOTID>',
        thread_ts: 'ts-123',
      });

      expect(mockSlackService.postMessage).not.toHaveBeenCalled();
    });
  });
});
