import './utils/env-loader';
import { join } from 'path';
import { readdirSync, unlinkSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { atomicWriteJson, readJsonFile } from '../libs/shared/src/utils/file.utils';
import { SessionMeta } from '../libs/shared/src/types/session.types';
import { QuestionFile } from '../libs/shared/src/types/question.types';
import { CurrentSessionFile, StopHookDecision } from '../libs/shared/src/types/hook.types';

const MAX_CONSECUTIVE_BLOCKS = 5;
const BLOCK_REASON =
  '[Slack 명령 대기 필요] slack_check_commands 도구를 blocking=true로 호출하여 Slack 명령 대기를 시작하세요. ' +
  '타임아웃 시 즉시 다시 호출하여 대기를 계속하세요.';

function readBlockCount(sessionDir: string): number {
  const countPath = join(sessionDir, '.stop-block-count');
  try {
    return parseInt(readFileSync(countPath, 'utf8'), 10) || 0;
  } catch {
    return 0;
  }
}

function writeBlockCount(sessionDir: string, count: number): void {
  const countPath = join(sessionDir, '.stop-block-count');
  writeFileSync(countPath, String(count));
}

function cleanupSession(
  session: { sessionId: string; sessionDir: string },
  stateDir: string,
): void {
  // Update meta.json to terminated
  const metaPath = join(session.sessionDir, 'meta.json');
  const meta = readJsonFile<SessionMeta>(metaPath);
  if (meta) {
    meta.status = 'terminated';
    meta.lastActiveAt = new Date().toISOString();
    atomicWriteJson(metaPath, meta);
  }

  // Expire all pending questions
  const questionsDir = join(session.sessionDir, 'questions');
  if (existsSync(questionsDir)) {
    const files = readdirSync(questionsDir).filter(
      (f) => f.startsWith('q-') && f.endsWith('.json'),
    );
    for (const file of files) {
      const qPath = join(questionsDir, file);
      const q = readJsonFile<QuestionFile>(qPath);
      if (q && q.status === 'pending') {
        q.status = 'expired';
        atomicWriteJson(qPath, q);
      }
    }
  }

  // Delete .current-session if it matches this session
  try {
    const currentSessionPath = join(stateDir, '.current-session');
    const currentFile = readJsonFile<CurrentSessionFile>(currentSessionPath);
    if (currentFile && currentFile.sessionId === session.sessionId) {
      unlinkSync(currentSessionPath);
    }
  } catch {
    // File may not exist
  }
}

async function main(): Promise<void> {
  const input = await readHookInput();

  const session = resolveSession(STATE_DIR);
  if (!session) return;

  // Check if exit flag exists (user requested stop via Slack "exit" command)
  const noLoopFlag = join(session.sessionDir, '.no-wait-loop');
  if (existsSync(noLoopFlag)) {
    try {
      unlinkSync(noLoopFlag);
    } catch {
      // ignore
    }
    cleanupSession(session, STATE_DIR);
    return;
  }

  // Circuit breaker: if too many consecutive blocks without successful wait loop entry
  const blockCount = readBlockCount(session.sessionDir);
  if (blockCount >= MAX_CONSECUTIVE_BLOCKS) {
    // Reset counter and allow stop
    writeBlockCount(session.sessionDir, 0);
    cleanupSession(session, STATE_DIR);
    return;
  }

  // Block Claude from stopping — force wait loop entry
  writeBlockCount(session.sessionDir, blockCount + 1);

  const decision: StopHookDecision = {
    decision: 'block',
    reason: BLOCK_REASON,
  };

  // Output JSON decision to stdout — Claude Code reads this
  console.log(JSON.stringify(decision));
}

main().catch((e) => console.error('[Hook:on-stop]', e)).finally(() => process.exit(0));
