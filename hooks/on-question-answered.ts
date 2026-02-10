import './utils/env-loader';
import { join } from 'path';
import { readdirSync, existsSync } from 'fs';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { atomicWriteJson, readJsonFile } from '../libs/shared/src/utils/file.utils';
import { QuestionFile, ResponseFile } from '../libs/shared/src/types/question.types';

async function main(): Promise<void> {
  const input = await readHookInput();
  const session = resolveSession(STATE_DIR);
  if (!session) return;

  // Extract answer from tool_output
  const toolOutput = input.tool_output || {};
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

  // Find the most recent pending question
  const questionsDir = join(session.sessionDir, 'questions');
  if (!existsSync(questionsDir)) return;

  const questionFiles = readdirSync(questionsDir)
    .filter((f) => f.startsWith('q-') && f.endsWith('.json'))
    .sort()
    .reverse();

  let targetQuestion: QuestionFile | null = null;
  let targetQuestionId: string | null = null;

  for (const file of questionFiles) {
    const q = readJsonFile<QuestionFile>(join(questionsDir, file));
    if (q && q.status === 'pending') {
      targetQuestion = q;
      targetQuestionId = q.questionId;
      break;
    }
  }

  if (!targetQuestion || !targetQuestionId) return;

  // Skip if already answered (e.g., from Slack)
  const responsesDir = join(session.sessionDir, 'responses');
  const responsePath = join(responsesDir, `${targetQuestionId}.json`);
  if (existsSync(responsePath)) return;

  // Write response file
  const responseFile: ResponseFile = {
    questionId: targetQuestionId,
    answer: answerText,
    respondedBy: 'cli',
    respondedAt: new Date().toISOString(),
    source: 'cli',
  };

  atomicWriteJson(responsePath, responseFile);

  // Update question status to answered
  targetQuestion.status = 'answered';
  atomicWriteJson(join(questionsDir, `${targetQuestionId}.json`), targetQuestion);
}

main().catch((e) => console.error('[Hook:on-question-answered]', e)).finally(() => process.exit(0));
