import './utils/env-loader';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { CommandFile } from '../libs/shared/src/types/command.types';

const COOLDOWN_MS = 10_000; // 10s cooldown
const RE_ENTRY_MSG =
  '[Slack 명령 처리 완료] ' +
  'slack_check_commands 도구를 blocking=true로 호출하여 다음 Slack 명령을 대기해주세요.';
const SKIP_TOOLS = [
  'slack_check_commands',
  // slack_command_result is intentionally NOT skipped — triggers re-entry into wait loop
  'slack_ask',
  'slack_notify',
  'slack_wait_response',
];

function resetStopBlockCount(sessionDir: string): void {
  const countPath = join(sessionDir, '.stop-block-count');
  try {
    writeFileSync(countPath, '0');
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const input = await readHookInput();

  // Reset stop-block counter when slack_check_commands is called
  // This proves the wait loop is active, so the Stop hook circuit breaker resets
  if (input.tool_name?.includes('slack_check_commands')) {
    const session = resolveSession(STATE_DIR);
    if (session) {
      resetStopBlockCount(session.sessionDir);
    }
    return;
  }

  // Skip other slack-related tools to prevent infinite loops
  if (input.tool_name && SKIP_TOOLS.some((t) => input.tool_name!.includes(t))) {
    return;
  }

  const session = resolveSession(STATE_DIR);
  if (!session) return;

  // Session-first-run: one-time notification to enter wait loop
  const notifiedMarker = join(session.sessionDir, '.wait-loop-notified');
  if (!existsSync(notifiedMarker)) {
    writeFileSync(notifiedMarker, String(Date.now()));
    console.log(
      '[Slack 명령 대기 시작] ' +
        'slack_check_commands 도구를 blocking=true로 호출하여 Slack 명령 대기를 시작해주세요.',
    );
    return;
  }

  const isCommandResult = input.tool_name?.includes('slack_command_result') ?? false;

  // Reset stop-block counter on slack_command_result (proves active processing)
  if (isCommandResult) {
    resetStopBlockCount(session.sessionDir);
  }

  // Cooldown check — slack_command_result bypasses cooldown
  const markerPath = join(session.sessionDir, '.command-notify-ts');
  if (!isCommandResult) {
    try {
      const lastNotify = parseInt(readFileSync(markerPath, 'utf8'), 10);
      if (Date.now() - lastNotify < COOLDOWN_MS) return;
    } catch {
      // Marker file doesn't exist - continue
    }
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
      console.log(
        `[Slack 명령 ${pendingCount}건 대기 중] ` +
          `slack_check_commands 도구를 호출하여 Slack에서 전달된 명령을 확인하고 실행해주세요.`,
      );
    } else if (isCommandResult) {
      writeFileSync(markerPath, String(Date.now()));
      console.log(RE_ENTRY_MSG);
    }
  } catch {
    // commands directory doesn't exist
    if (isCommandResult) {
      writeFileSync(markerPath, String(Date.now()));
      console.log(RE_ENTRY_MSG);
    }
  }
}

main().catch((e) => console.error('[Hook:on-check-commands]', e)).finally(() => process.exit(0));
