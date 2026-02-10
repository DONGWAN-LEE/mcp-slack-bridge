import {
  buildExecutionStartMessage,
  buildExecutionCompleteMessage,
  buildQueueStatusMessage,
} from '../execution-message.formatter';
import { ExecutionJob } from '@app/shared/types/executor.types';

describe('execution-message.formatter', () => {
  const channelId = 'C123';

  describe('buildExecutionStartMessage', () => {
    it('should format start message', () => {
      const job: ExecutionJob = {
        id: 'job-123456-uuid',
        prompt: 'add email column',
        requestedBy: 'U456',
        requestedAt: new Date().toISOString(),
        status: 'running',
      };

      const msg = buildExecutionStartMessage(job, channelId);
      expect(msg.text).toContain('작업 시작');
      expect(msg.blocks[0].text.text).toContain('add email column');
      expect(msg.blocks[0].text.text).toContain('U456');
    });

    it('should truncate long prompts', () => {
      const job: ExecutionJob = {
        id: 'job-id',
        prompt: 'a'.repeat(200),
        requestedBy: 'U456',
        requestedAt: new Date().toISOString(),
        status: 'running',
      };

      const msg = buildExecutionStartMessage(job, channelId);
      expect(msg.blocks[0].text.text).toContain('...');
    });
  });

  describe('buildExecutionCompleteMessage', () => {
    it('should format successful completion', () => {
      const job: ExecutionJob = {
        id: 'job-id',
        prompt: 'test prompt',
        requestedBy: 'U456',
        requestedAt: new Date().toISOString(),
        status: 'completed',
        result: { exitCode: 0, stdout: 'Done!', stderr: '', durationMs: 5000 },
      };

      const msg = buildExecutionCompleteMessage(job, channelId);
      expect(msg.text).toContain('완료');
      expect(msg.blocks[0].text.text).toContain('완료');
      expect(msg.blocks[0].text.text).toContain('5.0');
    });

    it('should format failure', () => {
      const job: ExecutionJob = {
        id: 'job-id',
        prompt: 'test',
        requestedBy: 'U456',
        requestedAt: new Date().toISOString(),
        status: 'failed',
        error: 'timeout',
      };

      const msg = buildExecutionCompleteMessage(job, channelId);
      expect(msg.text).toContain('실패');
    });
  });

  describe('buildQueueStatusMessage', () => {
    it('should show empty queue', () => {
      const msg = buildQueueStatusMessage([], [], channelId);
      expect(msg.blocks[1].text.text).toContain('작업이 없습니다');
    });

    it('should show running and queued jobs', () => {
      const running: ExecutionJob[] = [
        { id: '1', prompt: 'running task', requestedBy: 'U1', requestedAt: '', status: 'running' },
      ];
      const queued: ExecutionJob[] = [
        { id: '2', prompt: 'queued task', requestedBy: 'U2', requestedAt: '', status: 'queued' },
      ];

      const msg = buildQueueStatusMessage(running, queued, channelId);
      expect(msg.text).toContain('1개 실행 중');
      expect(msg.text).toContain('1개 대기');
    });
  });
});
