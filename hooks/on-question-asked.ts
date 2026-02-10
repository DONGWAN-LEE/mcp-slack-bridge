import './utils/env-loader';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { atomicWriteJson, ensureDir } from '../libs/shared/src/utils/file.utils';
import { QuestionFile } from '../libs/shared/src/types/question.types';

async function main(): Promise<void> {
  const input = await readHookInput();
  const session = resolveSession(STATE_DIR);
  if (!session) return;

  const toolInput = input.tool_input || {};
  const questions = toolInput.questions as Array<{ question?: string; options?: Array<{ label?: string }> }> | undefined;

  // Extract question text from AskUserQuestion tool_input
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

  const questionId = `q-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const questionsDir = join(session.sessionDir, 'questions');
  ensureDir(questionsDir);

  const questionFile: QuestionFile = {
    questionId,
    sessionId: session.sessionId,
    question: questionText,
    options,
    createdAt: new Date().toISOString(),
    timeout: 1800000,
    status: 'pending',
  };

  atomicWriteJson(join(questionsDir, `${questionId}.json`), questionFile);
}

main().catch((e) => console.error('[Hook:on-question-asked]', e)).finally(() => process.exit(0));
