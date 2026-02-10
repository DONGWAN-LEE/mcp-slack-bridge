import { ExecutorService } from '../executor.service';

describe('ExecutorService', () => {
  let service: ExecutorService;
  let mockQueueService: any;
  let mockSlackService: any;

  beforeEach(() => {
    mockQueueService = {
      enqueue: jest.fn(),
      dequeue: jest.fn(),
      updateJob: jest.fn(),
      getRunningJobs: jest.fn().mockResolvedValue([]),
      getQueuedJobs: jest.fn().mockResolvedValue([]),
      cancelJob: jest.fn(),
      findJobByPrefix: jest.fn(),
    };

    mockSlackService = {
      getChannelId: jest.fn().mockReturnValue('C123'),
      postMessage: jest.fn().mockResolvedValue({ ts: '123' }),
      isAllowedUser: jest.fn().mockReturnValue(true),
    };

    service = new ExecutorService(
      mockQueueService,
      mockSlackService,
      { workingDir: '/test', stateDir: './state' } as any,
      {
        allowedUserIds: ['U123'],
        blockedCommands: ['rm -rf', 'DROP TABLE'],
        confirmCommands: ['git push', 'git reset'],
        maxPromptLength: 2000,
      } as any,
      { maxConcurrent: 1, maxSize: 5, timeoutMs: 600000 } as any,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('validatePrompt', () => {
    it('should reject empty prompt', () => {
      const result = service.validatePrompt('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Empty prompt');
    });

    it('should reject prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(2001);
      const result = service.validatePrompt(longPrompt);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('max length');
    });

    it('should reject blocked commands', () => {
      const result = service.validatePrompt('please rm -rf /tmp');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Blocked command');
    });

    it('should accept valid prompt', () => {
      const result = service.validatePrompt('add email column to user table');
      expect(result.valid).toBe(true);
    });
  });

  describe('needsConfirmation', () => {
    it('should detect confirm commands', () => {
      const result = service.needsConfirmation('run git push to origin');
      expect(result).toBe('git push');
    });

    it('should return null for safe prompts', () => {
      const result = service.needsConfirmation('list all files');
      expect(result).toBeNull();
    });
  });

  describe('submitJob', () => {
    it('should delegate to queue service', async () => {
      const mockJob = { id: 'test-id', prompt: 'test', requestedBy: 'U123', status: 'queued' };
      mockQueueService.enqueue.mockResolvedValue(mockJob);

      const result = await service.submitJob('test', 'U123');
      expect(mockQueueService.enqueue).toHaveBeenCalledWith('test', 'U123', undefined);
      expect(result.id).toBe('test-id');
    });
  });

  describe('cancelJobById', () => {
    it('should find and cancel job', async () => {
      const mockJob = { id: 'abc12345-full-id', prompt: 'test', status: 'running' };
      mockQueueService.findJobByPrefix.mockResolvedValue(mockJob);
      mockQueueService.cancelJob.mockResolvedValue({ ...mockJob, status: 'cancelled' });

      const result = await service.cancelJobById('abc12345');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('cancelled');
    });

    it('should return null when job not found', async () => {
      mockQueueService.findJobByPrefix.mockResolvedValue(null);

      const result = await service.cancelJobById('notfound');
      expect(result).toBeNull();
    });
  });
});
