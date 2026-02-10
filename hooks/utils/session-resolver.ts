import { join } from 'path';
import { readJsonFile } from '../../libs/shared/src/utils/file.utils';
import { CurrentSessionFile } from '../../libs/shared/src/types/hook.types';
import { SessionMeta } from '../../libs/shared/src/types/session.types';

export interface ResolvedSession {
  sessionId: string;
  sessionDir: string;
}

export function resolveSession(stateDir: string): ResolvedSession | null {
  const currentSessionPath = join(stateDir, '.current-session');
  const currentFile = readJsonFile<CurrentSessionFile>(currentSessionPath);
  if (!currentFile || !currentFile.sessionId) {
    return null;
  }

  const sessionDir = join(stateDir, 'sessions', currentFile.sessionId);
  const metaPath = join(sessionDir, 'meta.json');
  const meta = readJsonFile<SessionMeta>(metaPath);

  if (!meta || meta.status === 'terminated') {
    return null;
  }

  return {
    sessionId: currentFile.sessionId,
    sessionDir,
  };
}
