import { FileBridgeService } from './file-bridge.service';
import * as fileUtils from '@app/shared/utils/file.utils';
import { QuestionFile } from '@app/shared/types/question.types';
import { NotificationFile } from '@app/shared/types/notification.types';

jest.mock('@app/shared/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
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
});
