import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { pathsConfig } from '@app/shared/config/configuration';
import { atomicWriteJson } from '@app/shared/utils/file.utils';
import { CommandFile } from '@app/shared/types/command.types';

@Injectable()
export class SessionThreadService {
  private readonly logger = new Logger(SessionThreadService.name);
  // threadTs → sessionId
  private readonly threadToSession = new Map<string, string>();
  // sessionId → threadTs
  private readonly sessionToThread = new Map<string, string>();

  constructor(
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  registerThread(threadTs: string, sessionId: string): void {
    if (this.threadToSession.get(threadTs) === sessionId) {
      return; // Already registered
    }
    this.threadToSession.set(threadTs, sessionId);
    this.sessionToThread.set(sessionId, threadTs);
    this.logger.debug(
      `Registered thread: ${threadTs} → session ${sessionId.slice(0, 8)}`,
    );
  }

  unregisterSession(sessionId: string): void {
    const threadTs = this.sessionToThread.get(sessionId);
    if (threadTs) {
      this.threadToSession.delete(threadTs);
    }
    this.sessionToThread.delete(sessionId);
  }

  findSessionByThreadTs(threadTs: string): string | null {
    return this.threadToSession.get(threadTs) ?? null;
  }

  isSessionThread(threadTs: string): boolean {
    return this.threadToSession.has(threadTs);
  }

  writeCommand(
    sessionId: string,
    command: string,
    requestedBy: string,
  ): CommandFile {
    const commandId = `cmd-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const commandFile: CommandFile = {
      commandId,
      sessionId,
      command,
      requestedBy,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    const filePath = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'commands',
      `${commandId}.json`,
    );
    atomicWriteJson(filePath, commandFile);

    this.logger.log(
      `Command written: session=${sessionId.slice(0, 8)} cmd=${commandId}`,
    );
    return commandFile;
  }
}
