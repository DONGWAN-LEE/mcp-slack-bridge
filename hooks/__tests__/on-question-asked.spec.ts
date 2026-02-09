import { join } from 'path';
import * as fileUtils from '../../libs/shared/src/utils/file.utils';
import { resolveSession } from '../utils/session-resolver';
import { QuestionFile } from '../../libs/shared/src/types/question.types';

jest.mock('../../libs/shared/src/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
  ensureDir: jest.fn(),
}));

jest.mock('../utils/session-resolver', () => ({
  resolveSession: jest.fn(),
}));

describe('on-question-asked logic', () => {
  const mockSessionDir = join('./state', 'sessions', 'test-session');
  const mockResolveSession = resolveSession as jest.MockedFunction<typeof resolveSession>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function simulateHook(toolInput: Record<string, unknown>, hasSession = true): void {
    if (hasSession) {
      mockResolveSession.mockReturnValue({
        sessionId: 'test-session',
        sessionDir: mockSessionDir,
      });
    } else {
      mockResolveSession.mockReturnValue(null);
    }

    const session = resolveSession('./state');
    if (!session) return;

    const questions = toolInput.questions as Array<{ question?: string; options?: Array<{ label?: string }> }> | undefined;
    let questionText = '';
    let options: string[] | undefined;

    if (Array.isArray(questions) && questions.length > 0) {
      questionText = questions.map((q) => q.question || '').filter(Boolean).join('\n');
      const firstWithOptions = questions.find((q) => Array.isArray(q.options) && q.options.length > 0);
      if (firstWithOptions && Array.isArray(firstWithOptions.options)) {
        options = firstWithOptions.options.map((o) => o.label || String(o)).filter(Boolean);
      }
    } else if (typeof toolInput.question === 'string') {
      questionText = toolInput.question;
    }

    if (!questionText) return;

    const questionId = `q-${Date.now()}-test1234`;
    const questionsDir = join(session.sessionDir, 'questions');
    fileUtils.ensureDir(questionsDir);

    const questionFile: QuestionFile = {
      questionId,
      sessionId: session.sessionId,
      question: questionText,
      options,
      createdAt: new Date().toISOString(),
      timeout: 1800000,
      status: 'pending',
    };

    fileUtils.atomicWriteJson(join(questionsDir, `${questionId}.json`), questionFile);
  }

  it('should write question file when session exists and question provided', () => {
    simulateHook({
      questions: [{ question: 'Which approach?', options: [{ label: 'A' }, { label: 'B' }] }],
    });

    expect(fileUtils.ensureDir).toHaveBeenCalledWith(expect.stringContaining('questions'));
    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('questions'),
      expect.objectContaining({
        sessionId: 'test-session',
        question: 'Which approach?',
        options: ['A', 'B'],
        status: 'pending',
      }),
    );
  });

  it('should handle simple question string in tool_input', () => {
    simulateHook({ question: 'Simple question?' });

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('questions'),
      expect.objectContaining({
        question: 'Simple question?',
      }),
    );
  });

  it('should do nothing when no session', () => {
    simulateHook({ question: 'test?' }, false);

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should do nothing when no question text', () => {
    simulateHook({ something: 'else' });

    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should handle multiple questions', () => {
    simulateHook({
      questions: [
        { question: 'First?' },
        { question: 'Second?' },
      ],
    });

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        question: 'First?\nSecond?',
      }),
    );
  });
});
