import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { unlinkSync } from 'fs';
import { join, basename } from 'path';
import { SessionMeta } from '@app/shared/types/session.types';
import { CurrentSessionFile } from '@app/shared/types/hook.types';
import { sessionConfig, pathsConfig } from '@app/shared/config/configuration';
import {
  atomicWriteJson,
  readJsonFile,
  ensureDir,
  touchFile,
} from '@app/shared/utils/file.utils';
import { EnvironmentDetector } from './environment.detector';

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private currentSession: SessionMeta | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly envDetector: EnvironmentDetector,
    @Inject(sessionConfig.KEY)
    private readonly sessionCfg: ConfigType<typeof sessionConfig>,
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    const projectPath = this.pathsCfg.workingDir;
    this.createSession(projectPath);
  }

  async onModuleDestroy(): Promise<void> {
    this.terminateSession();
  }

  createSession(projectPath: string, claudeSessionId?: string): SessionMeta {
    if (this.currentSession) {
      this.terminateSession();
    }

    const sessionId = uuidv4();
    const environment = this.envDetector.detect();
    const gitBranch = this.detectGitBranch(projectPath);
    const now = new Date().toISOString();

    const sessionDir = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
    );

    // Create session directory structure
    ensureDir(sessionDir);
    ensureDir(join(sessionDir, 'questions'));
    ensureDir(join(sessionDir, 'responses'));
    ensureDir(join(sessionDir, 'notifications'));
    ensureDir(join(sessionDir, 'commands'));
    ensureDir(join(sessionDir, 'command-results'));

    const meta: SessionMeta = {
      sessionId,
      claudeSessionId,
      environment,
      projectPath,
      projectName: basename(projectPath),
      gitBranch,
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
    };

    // Write meta.json
    const metaPath = join(sessionDir, 'meta.json');
    atomicWriteJson(metaPath, meta);

    // Create initial heartbeat file
    const heartbeatPath = join(sessionDir, 'heartbeat');
    touchFile(heartbeatPath);

    // Start heartbeat interval
    this.startHeartbeat(sessionDir);

    // Write .current-session file for hook scripts
    const currentSessionFile: CurrentSessionFile = {
      sessionId,
      projectPath,
      createdAt: now,
      pid: process.pid,
    };
    const currentSessionPath = join(this.pathsCfg.stateDir, '.current-session');
    atomicWriteJson(currentSessionPath, currentSessionFile);

    this.currentSession = meta;
    console.error(`[Session] Created: ${sessionId} (${environment.displayName})`);

    return meta;
  }

  terminateSession(): void {
    if (!this.currentSession) return;

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Read-merge-write to preserve Bot-written fields (e.g. slackThreadTs)
    const sessionDir = join(
      this.pathsCfg.stateDir,
      'sessions',
      this.currentSession.sessionId,
    );
    const metaPath = join(sessionDir, 'meta.json');

    try {
      const existing = readJsonFile<SessionMeta>(metaPath);
      const updated: SessionMeta = {
        ...(existing || this.currentSession),
        status: 'terminated',
        lastActiveAt: new Date().toISOString(),
      };
      atomicWriteJson(metaPath, updated);
      console.error(`[Session] Terminated: ${this.currentSession.sessionId}`);
    } catch (e) {
      console.error(`[Session] Failed to write terminated status: ${e}`);
    }

    // Remove .current-session if it matches this session
    try {
      const currentSessionPath = join(this.pathsCfg.stateDir, '.current-session');
      const currentFile = readJsonFile<CurrentSessionFile>(currentSessionPath);
      if (currentFile && currentFile.sessionId === this.currentSession.sessionId) {
        unlinkSync(currentSessionPath);
      }
    } catch (err) {
      console.error(`[Session] Failed to remove .current-session: ${(err as Error).message}`);
    }

    this.currentSession = null;
  }

  getSession(): SessionMeta | null {
    return this.currentSession;
  }

  private startHeartbeat(sessionDir: string): void {
    const heartbeatPath = join(sessionDir, 'heartbeat');
    const metaPath = join(sessionDir, 'meta.json');

    this.heartbeatTimer = setInterval(() => {
      if (!this.currentSession) return;
      try {
        touchFile(heartbeatPath);

        // Read-merge-write to preserve Bot-written fields (e.g. slackThreadTs)
        const existing = readJsonFile<SessionMeta>(metaPath);
        const updated: SessionMeta = {
          ...(existing || this.currentSession),
          lastActiveAt: new Date().toISOString(),
          status: this.currentSession.status,
        };
        atomicWriteJson(metaPath, updated);
        this.currentSession = updated;

        this.ensureCurrentSessionFile();
      } catch (e) {
        console.error(`[Session] Heartbeat failed: ${e}`);
      }
    }, this.sessionCfg.heartbeatMs);
  }

  private ensureCurrentSessionFile(): void {
    if (!this.currentSession) return;

    const currentSessionPath = join(this.pathsCfg.stateDir, '.current-session');
    const currentFile = readJsonFile<CurrentSessionFile>(currentSessionPath);

    // Already pointing to this session
    if (currentFile && currentFile.sessionId === this.currentSession.sessionId) {
      return;
    }

    // Different session owns .current-session — do NOT overwrite
    if (currentFile && currentFile.sessionId) {
      return;
    }

    // File is missing — restore it
    const newFile: CurrentSessionFile = {
      sessionId: this.currentSession.sessionId,
      projectPath: this.currentSession.projectPath,
      createdAt: this.currentSession.createdAt,
      pid: process.pid,
    };
    atomicWriteJson(currentSessionPath, newFile);
    console.error(
      `[Session] .current-session restored for ${this.currentSession.sessionId.slice(0, 8)}`,
    );
  }

  private detectGitBranch(projectPath: string): string | undefined {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
    } catch (err) {
      console.error(`[Session] Failed to detect git branch: ${(err as Error).message}`);
      return undefined;
    }
  }
}
