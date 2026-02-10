import { QueueService } from '../queue.service';
import {
  readJsonFile,
  atomicWriteJson,
  FileLock,
} from '@app/shared/utils/file.utils';
import { ExecutionJob, QueueFile } from '@app/shared/types/executor.types';

jest.mock('@app/shared/utils/file.utils');

const mockReadJsonFile = readJsonFile as jest.MockedFunction<typeof readJsonFile>;
const mockAtomicWriteJson = atomicWriteJson as jest.MockedFunction<typeof atomicWriteJson>;

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock FileLock
    jest.spyOn(FileLock.prototype, 'acquire').mockResolvedValue(undefined);
    jest.spyOn(FileLock.prototype, 'release').mockReturnValue(undefined);

    service = new QueueService(
      { stateDir: './state' } as any,
      { maxConcurrent: 1, maxSize: 5, timeoutMs: 600000 } as any,
    );
  });

  describe('enqueue', () => {
    it('should add a job to the queue', async () => {
      mockReadJsonFile.mockReturnValue({ queue: [] });

      const job = await service.enqueue('test prompt', 'U123');

      expect(job.prompt).toBe('test prompt');
      expect(job.requestedBy).toBe('U123');
      expect(job.status).toBe('queued');
      expect(mockAtomicWriteJson).toHaveBeenCalledTimes(1);
    });

    it('should throw when queue is full', async () => {
      const fullQueue: QueueFile = {
        queue: Array(5).fill(null).map(() => ({
          id: 'id',
          prompt: 'p',
          requestedBy: 'U',
          requestedAt: '',
          status: 'queued' as const,
        })),
      };
      mockReadJsonFile.mockReturnValue(fullQueue);

      await expect(service.enqueue('test', 'U123')).rejects.toThrow('Queue is full');
    });
  });

  describe('dequeue', () => {
    it('should return null when no queued jobs', async () => {
      mockReadJsonFile.mockReturnValue({ queue: [] });

      const result = await service.dequeue();
      expect(result).toBeNull();
    });

    it('should return null when max concurrent reached', async () => {
      const queue: QueueFile = {
        queue: [
          { id: '1', prompt: 'p1', requestedBy: 'U', requestedAt: '', status: 'running' },
          { id: '2', prompt: 'p2', requestedBy: 'U', requestedAt: '', status: 'queued' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const result = await service.dequeue();
      expect(result).toBeNull();
    });

    it('should dequeue next job and set to running', async () => {
      const queue: QueueFile = {
        queue: [
          { id: 'job-1', prompt: 'p1', requestedBy: 'U', requestedAt: '', status: 'queued' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const result = await service.dequeue();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
      expect(mockAtomicWriteJson).toHaveBeenCalled();
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      const queue: QueueFile = {
        queue: [
          { id: 'job-1', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'queued' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const cancelled = await service.cancelJob('job-1');
      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
    });

    it('should return null for completed job', async () => {
      const queue: QueueFile = {
        queue: [
          { id: 'job-1', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'completed' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const cancelled = await service.cancelJob('job-1');
      expect(cancelled).toBeNull();
    });
  });

  describe('getRunningJobs', () => {
    it('should return only running jobs', async () => {
      const queue: QueueFile = {
        queue: [
          { id: '1', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'running' },
          { id: '2', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'queued' },
          { id: '3', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'completed' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const running = await service.getRunningJobs();
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('1');
    });
  });

  describe('findJobByPrefix', () => {
    it('should find job by id prefix', async () => {
      const queue: QueueFile = {
        queue: [
          { id: 'abc123-def', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'running' },
          { id: 'xyz789-ghi', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'queued' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const found = await service.findJobByPrefix('abc123');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('abc123-def');
    });

    it('should return null for ambiguous prefix', async () => {
      const queue: QueueFile = {
        queue: [
          { id: 'abc-1', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'running' },
          { id: 'abc-2', prompt: 'p', requestedBy: 'U', requestedAt: '', status: 'running' },
        ],
      };
      mockReadJsonFile.mockReturnValue(queue);

      const found = await service.findJobByPrefix('abc');
      expect(found).toBeNull();
    });
  });
});
