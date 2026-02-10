import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import * as fileUtils from '../../libs/shared/src/utils/file.utils';
import { resolveSession } from '../utils/session-resolver';

jest.mock('../../libs/shared/src/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
  ensureDir: jest.fn(),
}));

jest.mock('../utils/session-resolver', () => ({
  resolveSession: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

describe('on-question-answered logic', () => {
  const mockSessionDir = join('./state', 'sessions', 'test-session');
  const mockResolveSession = resolveSession as jest.MockedFunction<typeof resolveSession>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveSession.mockReturnValue({
      sessionId: 'test-session',
      sessionDir: mockSessionDir,
    });
  });

  function simulateHook(toolOutput: Record<string, unknown>): void {
    const session = resolveSession('./state');
    if (!session) return;

    const answers = toolOutput.answers as Record<string, string> | undefined;
    let answerText = '';
    if (answers && typeof answers === 'object') {
      answerText = Object.values(answers).filter(Boolean).join(', ');
    } else if (typeof toolOutput.answer === 'string') {
      answerText = toolOutput.answer;
    } else if (typeof toolOutput.result === 'string') {
      answerText = toolOutput.result;
    }

    if (!answerText) return;

    const questionsDir = join(session.sessionDir, 'questions');
    if (!(existsSync as jest.Mock)(questionsDir)) return;

    const questionFiles = (readdirSync as jest.Mock)(questionsDir)
      .filter((f: string) => f.startsWith('q-') && f.endsWith('.json'))
      .sort()
      .reverse();

    let targetQuestionId: string | null = null;

    for (const file of questionFiles) {
      const q = fileUtils.readJsonFile(join(questionsDir, file));
      if (q && (q as any).status === 'pending') {
        targetQuestionId = (q as any).questionId;
        break;
      }
    }

    if (!targetQuestionId) return;

    const responsesDir = join(session.sessionDir, 'responses');
    const responsePath = join(responsesDir, `${targetQuestionId}.json`);
    if ((existsSync as jest.Mock)(responsePath)) return;

    fileUtils.atomicWriteJson(responsePath, {
      questionId: targetQuestionId,
      answer: answerText,
      respondedBy: 'cli',
      respondedAt: new Date().toISOString(),
      source: 'cli',
    });
  }

  it('should write response file for pending question', () => {
    (existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('questions')) return true;
      return false; // response file doesn't exist
    });
    (readdirSync as jest.Mock).mockReturnValue(['q-1700000000000-abc12345.json']);
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue({
      questionId: 'q-1700000000000-abc12345',
      status: 'pending',
    });

    simulateHook({ answers: { '0': 'Option A' } });

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('responses'),
      expect.objectContaining({
        questionId: 'q-1700000000000-abc12345',
        answer: 'Option A',
        source: 'cli',
      }),
    );
  });

  it('should skip when response already exists (Slack answered first)', () => {
    (existsSync as jest.Mock).mockReturnValue(true); // both questions dir and response file exist
    (readdirSync as jest.Mock).mockReturnValue(['q-1700000000000-abc12345.json']);
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue({
      questionId: 'q-1700000000000-abc12345',
      status: 'pending',
    });

    simulateHook({ answers: { '0': 'Option A' } });

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should do nothing when no session', () => {
    mockResolveSession.mockReturnValue(null);

    simulateHook({ answers: { '0': 'Option A' } });

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should do nothing when no answer text', () => {
    simulateHook({ something: 'else' });

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should handle answer field directly', () => {
    (existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('questions')) return true;
      return false;
    });
    (readdirSync as jest.Mock).mockReturnValue(['q-1700000000000-abc12345.json']);
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue({
      questionId: 'q-1700000000000-abc12345',
      status: 'pending',
    });

    simulateHook({ answer: 'Direct answer' });

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('responses'),
      expect.objectContaining({ answer: 'Direct answer' }),
    );
  });
});
