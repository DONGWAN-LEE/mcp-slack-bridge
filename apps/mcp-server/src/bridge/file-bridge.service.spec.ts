import { FileBridgeService } from './file-bridge.service';
import * as fileUtils from '@app/shared/utils/file.utils';
import { readdirSync } from 'fs';
import { QuestionFile } from '@app/shared/types/question.types';
import { NotificationFile } from '@app/shared/types/notification.types';
import { CommandFile, CommandResultFile } from '@app/shared/types/command.types';

jest.mock('@app/shared/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readdirSync: jest.fn(),
}));

describe('FileBridgeService', () => {
  let service: FileBridgeService;
  const mockPathsCfg = { stateDir: './state', workingDir: '/test' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FileBridgeService(mockPathsCfg as any);
  });

  describe('writeQuestion', () => {
    it('should call atomicWriteJson with correct path', () => {
      const question: QuestionFile = {
        questionId: 'q-123',
        sessionId: 'sess-1',
        question: 'Test?',
        createdAt: '2026-01-01T00:00:00Z',
        timeout: 30000,
        status: 'pending',
      };

      service.writeQuestion(question);

      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('sess-1'),
        question,
      );
      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('q-123.json'),
        question,
      );
    });
  });

  describe('readResponse', () => {
    it('should return response when file exists', () => {
      const mockResponse = {
        questionId: 'q-123',
        answer: 'Yes',
        respondedBy: 'U123',
        respondedAt: '2026-01-01T00:01:00Z',
        source: 'slack_button' as const,
      };
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue(mockResponse);

      const result = service.readResponse('sess-1', 'q-123');

      expect(result).toEqual(mockResponse);
      expect(fileUtils.readJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('responses'),
      );
    });

    it('should return null when file does not exist', () => {
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue(null);

      const result = service.readResponse('sess-1', 'q-999');

      expect(result).toBeNull();
    });
  });

  describe('writeNotification', () => {
    it('should call atomicWriteJson with correct path', () => {
      const notification: NotificationFile = {
        notificationId: 'n-123',
        sessionId: 'sess-1',
        message: 'Build complete',
        level: 'info',
        createdAt: '2026-01-01T00:00:00Z',
      };

      service.writeNotification(notification);

      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('n-123.json'),
        notification,
      );
      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        notification,
      );
    });
  });

  describe('updateQuestionStatus', () => {
    it('should read, update status, and write back', () => {
      const existingQuestion: QuestionFile = {
        questionId: 'q-123',
        sessionId: 'sess-1',
        question: 'Test?',
        createdAt: '2026-01-01T00:00:00Z',
        timeout: 30000,
        status: 'pending',
      };
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue({ ...existingQuestion });

      service.updateQuestionStatus('sess-1', 'q-123', 'answered');

      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('q-123.json'),
        expect.objectContaining({ status: 'answered' }),
      );
    });

    it('should do nothing when question file does not exist', () => {
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue(null);

      service.updateQuestionStatus('sess-1', 'q-999', 'expired');

      expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
    });
  });

  describe('path traversal prevention', () => {
    it('should reject sessionId with path separators', () => {
      expect(() =>
        service.readResponse('../../../etc', 'q-123'),
      ).toThrow('Invalid path segment');
    });

    it('should reject questionId with path separators', () => {
      expect(() =>
        service.readResponse('sess-1', '../../secret'),
      ).toThrow('Invalid path segment');
    });

    it('should reject backslash path traversal', () => {
      expect(() =>
        service.readResponse('sess-1', '..\\..\\secret'),
      ).toThrow('Invalid path segment');
    });
  });

  describe('readPendingCommands', () => {
    it('should return only pending commands sorted by createdAt', () => {
      const pendingCmd: CommandFile = {
        commandId: 'cmd-1',
        sessionId: 'sess-1',
        command: 'first',
        requestedBy: 'U1',
        createdAt: '2026-01-01T00:02:00Z',
        status: 'pending',
      };
      const olderPendingCmd: CommandFile = {
        commandId: 'cmd-2',
        sessionId: 'sess-1',
        command: 'older',
        requestedBy: 'U2',
        createdAt: '2026-01-01T00:01:00Z',
        status: 'pending',
      };
      const receivedCmd: CommandFile = {
        commandId: 'cmd-3',
        sessionId: 'sess-1',
        command: 'already received',
        requestedBy: 'U3',
        createdAt: '2026-01-01T00:00:00Z',
        status: 'received',
      };

      (readdirSync as jest.Mock).mockReturnValue([
        'cmd-1.json',
        'cmd-2.json',
        'cmd-3.json',
      ]);
      (fileUtils.readJsonFile as jest.Mock)
        .mockReturnValueOnce(pendingCmd)
        .mockReturnValueOnce(olderPendingCmd)
        .mockReturnValueOnce(receivedCmd);

      const result = service.readPendingCommands('sess-1');

      expect(result).toHaveLength(2);
      expect(result[0].commandId).toBe('cmd-2'); // older first
      expect(result[1].commandId).toBe('cmd-1');
    });

    it('should return empty array when directory does not exist', () => {
      (readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = service.readPendingCommands('sess-1');

      expect(result).toEqual([]);
    });
  });

  describe('updateCommandStatus', () => {
    it('should read command, update status, and write back', () => {
      const existingCmd: CommandFile = {
        commandId: 'cmd-1',
        sessionId: 'sess-1',
        command: 'test',
        requestedBy: 'U1',
        createdAt: '2026-01-01T00:00:00Z',
        status: 'pending',
      };
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue({ ...existingCmd });

      service.updateCommandStatus('sess-1', 'cmd-1', 'received');

      expect(fileUtils.readJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('cmd-1.json'),
      );
      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('cmd-1.json'),
        expect.objectContaining({ status: 'received' }),
      );
    });

    it('should do nothing when command file does not exist', () => {
      (fileUtils.readJsonFile as jest.Mock).mockReturnValue(null);

      service.updateCommandStatus('sess-1', 'cmd-999', 'received');

      expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
    });
  });

  describe('writeCommandResult', () => {
    it('should write result file to command-results directory', () => {
      const result: CommandResultFile = {
        commandId: 'cmd-1',
        sessionId: 'sess-1',
        result: 'done',
        status: 'success',
        completedAt: '2026-01-01T00:05:00Z',
      };

      service.writeCommandResult(result);

      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('command-results'),
        result,
      );
      expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('cmd-1.json'),
        result,
      );
    });
  });
});
