import { registerAs } from '@nestjs/config';

function envList(val: string | undefined, fallback: string[] = []): string[] {
  if (!val) return fallback;
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const slackConfig = registerAs('slack', () => ({
  botToken: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  channelId: process.env.SLACK_CHANNEL_ID,
}));

export const securityConfig = registerAs('security', () => ({
  allowedUserIds: envList(process.env.ALLOWED_USER_IDS),
  allowedChannelIds: envList(process.env.ALLOWED_CHANNEL_IDS),
  blockedCommands: envList(process.env.BLOCKED_COMMANDS, [
    'rm -rf',
    'format',
    'del /f',
    'DROP TABLE',
    'DROP DATABASE',
  ]),
  confirmCommands: envList(process.env.CONFIRM_COMMANDS, [
    'git push',
    'git reset',
    'database migration',
    'delete',
    'remove',
  ]),
  maxPromptLength: parseInt(process.env.MAX_PROMPT_LENGTH || '2000', 10),
}));

export const sessionConfig = registerAs('session', () => ({
  maxActive: parseInt(process.env.MAX_ACTIVE_SESSIONS || '10', 10),
  timeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000', 10),
  heartbeatMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
  staleMs: parseInt(process.env.STALE_SESSION_MS || '300000', 10),
}));

export const pollingConfig = registerAs('polling', () => ({
  intervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
}));

export const queueConfig = registerAs('queue', () => ({
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '1', 10),
  maxSize: parseInt(process.env.MAX_QUEUE_SIZE || '5', 10),
  timeoutMs: parseInt(process.env.EXECUTION_TIMEOUT_MS || '600000', 10),
}));

export const pathsConfig = registerAs('paths', () => ({
  workingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
  stateDir: process.env.STATE_DIR || './state',
}));
