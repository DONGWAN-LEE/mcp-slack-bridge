import {
  writeFileSync,
  renameSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
  openSync,
  closeSync,
  statSync,
  constants,
} from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

/**
 * Atomic JSON file write using write-then-rename pattern.
 * Ensures readers never see partially written files.
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');

  try {
    renameSync(tmpPath, filePath);
  } catch {
    // Windows fallback: rename fails when target exists
    if (existsSync(filePath)) unlinkSync(filePath);
    renameSync(tmpPath, filePath);
  }
}

/**
 * Read and parse a JSON file. Returns null if file doesn't exist or is invalid.
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * File-based lock for shared resources (e.g., execution-queue.json).
 * Uses O_CREAT | O_EXCL to prevent TOCTOU race conditions.
 */
export class FileLock {
  private lockPath: string;

  constructor(targetPath: string) {
    this.lockPath = `${targetPath}.lock`;
  }

  async acquire(timeoutMs: number = 5000): Promise<void> {
    const start = Date.now();
    while (true) {
      try {
        const fd = openSync(
          this.lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        );
        writeFileSync(fd, String(process.pid), 'utf8');
        closeSync(fd);
        return;
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== 'EEXIST') throw e;

        // Stale lock detection: force-release if older than 60s
        try {
          const stat = statSync(this.lockPath);
          if (Date.now() - stat.mtimeMs > 60000) {
            unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          continue;
        }

        if (Date.now() - start > timeoutMs) {
          throw new Error('Lock acquisition timeout');
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  release(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* already deleted */
    }
  }
}
