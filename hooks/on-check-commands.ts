import './utils/env-loader';
import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { CommandFile } from '../libs/shared/src/types/command.types';

const COOLDOWN_MS = 10_000; // 10s cooldown
const SKIP_TOOLS = [
  'slack_check_commands',
  'slack_command_result',
  'slack_ask',
  'slack_notify',
  'slack_wait_response',
];

async function main(): Promise<void> {
  const input = await readHookInput();

  // Skip slack-related tools to prevent infinite loops
  if (input.tool_name && SKIP_TOOLS.some((t) => input.tool_name!.includes(t))) {
    return;
  }

  const session = resolveSession(STATE_DIR);
  if (!session) return;

  // Cooldown check
  const markerPath = join(session.sessionDir, '.command-notify-ts');
  try {
    const lastNotify = parseInt(readFileSync(markerPath, 'utf8'), 10);
    if (Date.now() - lastNotify < COOLDOWN_MS) return;
  } catch {
    // Marker file doesn't exist - continue
  }

  // Check for pending commands
  const commandsDir = join(session.sessionDir, 'commands');
  try {
    const files = readdirSync(commandsDir).filter((f) => f.endsWith('.json'));
    let pendingCount = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(commandsDir, file), 'utf8')) as CommandFile;
        if (data.status === 'pending') pendingCount++;
      } catch {
        // Ignore individual file read errors
      }
    }

    if (pendingCount > 0) {
      writeFileSync(markerPath, String(Date.now()));
      // stdout output -> Claude Code AI picks it up
      console.log(
        `[Slack 명령 ${pendingCount}건 대기 중] ` +
          `slack_check_commands 도구를 호출하여 Slack에서 전달된 명령을 확인하고 실행해주세요.`,
      );
    }
  } catch {
    // commands directory doesn't exist - normal
  }
}

main().catch((e) => console.error('[Hook:on-check-commands]', e)).finally(() => process.exit(0));
