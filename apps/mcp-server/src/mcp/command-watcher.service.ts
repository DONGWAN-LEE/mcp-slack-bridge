import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { join } from 'path';
import { existsSync, watch, FSWatcher } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pathsConfig } from '@app/shared/config/configuration';

@Injectable()
export class CommandWatcherService implements OnModuleDestroy {
  private watcher: FSWatcher | null = null;
  private lastNotifyTs = 0;
  private readonly DEBOUNCE_MS = 5_000;

  constructor(
    @Inject(pathsConfig.KEY)
    private readonly pathsCfg: ConfigType<typeof pathsConfig>,
  ) {}

  startWatching(sessionId: string, mcpServer: McpServer): void {
    const commandsDir = join(
      this.pathsCfg.stateDir,
      'sessions',
      sessionId,
      'commands',
    );

    if (!existsSync(commandsDir)) {
      console.error(`[CommandWatcher] Directory not found: ${commandsDir}`);
      return;
    }

    this.stopWatching();
    this.lastNotifyTs = 0;

    this.watcher = watch(commandsDir, (eventType, filename) => {
      if (!filename?.endsWith('.json')) return;

      const now = Date.now();
      if (now - this.lastNotifyTs < this.DEBOUNCE_MS) return;
      this.lastNotifyTs = now;

      mcpServer
        .sendLoggingMessage({
          level: 'info',
          logger: 'slack-bridge',
          data: '[Slack 명령 도착] slack_check_commands 도구를 blocking=true로 호출하여 Slack 명령을 확인해주세요.',
        })
        .catch((err) => {
          console.error('[CommandWatcher] Notification failed:', err);
        });
    });

    this.watcher.on('error', (err) => {
      console.error('[CommandWatcher] Watcher error:', err);
      this.stopWatching();
    });

    console.error(`[CommandWatcher] Watching: ${commandsDir}`);
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  onModuleDestroy(): void {
    this.stopWatching();
  }
}
