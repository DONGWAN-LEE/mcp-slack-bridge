import './utils/env-loader';
import { join } from 'path';
import { readdirSync, unlinkSync, existsSync } from 'fs';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { atomicWriteJson, readJsonFile } from '../libs/shared/src/utils/file.utils';
import { SessionMeta } from '../libs/shared/src/types/session.types';
import { QuestionFile } from '../libs/shared/src/types/question.types';
import { CurrentSessionFile } from '../libs/shared/src/types/hook.types';

async function main(): Promise<void> {
  // Consume stdin (may be empty JSON)
  await readHookInput();

  const session = resolveSession(STATE_DIR);
  if (!session) return;

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
    const currentSessionPath = join(STATE_DIR, '.current-session');
    const currentFile = readJsonFile<CurrentSessionFile>(currentSessionPath);
    if (currentFile && currentFile.sessionId === session.sessionId) {
      unlinkSync(currentSessionPath);
    }
  } catch {
    // File may not exist
  }
}

main().catch((e) => console.error('[Hook:on-stop]', e)).finally(() => process.exit(0));
