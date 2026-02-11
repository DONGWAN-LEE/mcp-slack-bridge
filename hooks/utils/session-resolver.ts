import { join } from 'path';
import { readdirSync } from 'fs';
import { readJsonFile } from '../../libs/shared/src/utils/file.utils';
import { CurrentSessionFile } from '../../libs/shared/src/types/hook.types';
import { SessionMeta } from '../../libs/shared/src/types/session.types';

export interface ResolvedSession {
  sessionId: string;
  sessionDir: string;
}

export function resolveSession(stateDir: string): ResolvedSession | null {
  // Primary: .current-session (fast path)
  const currentSessionPath = join(stateDir, '.current-session');
  const currentFile = readJsonFile<CurrentSessionFile>(currentSessionPath);
  if (currentFile && currentFile.sessionId) {
    const sessionDir = join(stateDir, 'sessions', currentFile.sessionId);
    const metaPath = join(sessionDir, 'meta.json');
    const meta = readJsonFile<SessionMeta>(metaPath);
    if (meta && meta.status !== 'terminated') {
      return { sessionId: currentFile.sessionId, sessionDir };
    }
  }

  // Fallback: scan for most recently active session
  return resolveSessionByScanning(stateDir);
}

function resolveSessionByScanning(stateDir: string): ResolvedSession | null {
  const sessionsDir = join(stateDir, 'sessions');
  try {
    const dirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let best: { id: string; lastActiveMs: number } | null = null;

    for (const dir of dirs) {
      const metaPath = join(sessionsDir, dir, 'meta.json');
      const meta = readJsonFile<SessionMeta>(metaPath);
      if (!meta || meta.status === 'terminated') continue;

      const lastActiveMs = new Date(meta.lastActiveAt || meta.createdAt).getTime();
      if (Number.isNaN(lastActiveMs)) continue;
      if (!best || lastActiveMs > best.lastActiveMs) {
        best = { id: dir, lastActiveMs };
      }
    }

    if (best) {
      process.stderr.write(`[session-resolver] Fallback scan found session: ${best.id}\n`);
      return {
        sessionId: best.id,
        sessionDir: join(sessionsDir, best.id),
      };
    }
  } catch {
    // sessions directory doesn't exist
  }
  return null;
}
