import { SessionThreadService } from './session-thread.service';
import * as fileUtils from '@app/shared/utils/file.utils';

jest.mock('@app/shared/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
}));

describe('SessionThreadService', () => {
  let service: SessionThreadService;
  const mockPathsCfg = { stateDir: './state', workingDir: '/test' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionThreadService(mockPathsCfg as any);
  });

  describe('registerThread / findSessionByThreadTs', () => {
    it('should map threadTs to sessionId', () => {
      service.registerThread('ts-100', 'sess-abc');

      expect(service.findSessionByThreadTs('ts-100')).toBe('sess-abc');
    });
  });

  describe('isSessionThread', () => {
    it('should return true for registered thread', () => {
      service.registerThread('ts-200', 'sess-def');

      expect(service.isSessionThread('ts-200')).toBe(true);
    });

    it('should return false for unregistered thread', () => {
      expect(service.isSessionThread('ts-unknown')).toBe(false);
    });
  });

  describe('idempotent registerThread', () => {
    it('should silently ignore duplicate registration with same pair', () => {
      service.registerThread('ts-300', 'sess-ghi');
      service.registerThread('ts-300', 'sess-ghi');

      expect(service.findSessionByThreadTs('ts-300')).toBe('sess-ghi');
    });
  });

  describe('unregisterSession', () => {
    it('should remove both directions of mapping', () => {
      service.registerThread('ts-400', 'sess-jkl');

      service.unregisterSession('sess-jkl');

      expect(service.findSessionByThreadTs('ts-400')).toBeNull();
      expect(service.isSessionThread('ts-400')).toBe(false);
    });

    it('should be safe to call for non-existent session', () => {
      expect(() => service.unregisterSession('no-exist')).not.toThrow();
    });
  });

  describe('findSessionByThreadTs', () => {
    it('should return null for unregistered threadTs', () => {
      expect(service.findSessionByThreadTs('ts-missing')).toBeNull();
    });
  });

  describe('writeCommand', () => {
    it('should call atomicWriteJson with correct CommandFile structure', () => {
      service.registerThread('ts-500', 'sess-mno');

      const result = service.writeCommand('sess-mno', 'run tests', 'U123');

      expect(result).toEqual(
        expect.objectContaining({
          sessionId: 'sess-mno',
          command: 'run tests',
          requestedBy: 'U123',
          status: 'pending',
        }),
      );
      expect(result.commandId).toMatch(/^cmd-/);
      expect(result.createdAt).toBeDefined();

      expect(fileUtils.atomicWriteJson).toHaveBeenCalledTimes(1);
      const [filePath, fileData] = (fileUtils.atomicWriteJson as jest.Mock).mock.calls[0];
      expect(filePath).toContain('sess-mno');
      expect(filePath).toContain('commands');
      expect(filePath).toContain(`${result.commandId}.json`);
      expect(fileData).toEqual(
        expect.objectContaining({ commandId: result.commandId }),
      );
    });
  });
});
