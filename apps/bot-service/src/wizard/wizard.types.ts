/**
 * Wizard configuration data structure.
 * Represents all user inputs collected through the setup wizard.
 */
export interface WizardConfig {
  // Required - Slack connection
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  slackChannelId: string;

  // Required - Security
  allowedUserIds: string[];
  allowedChannelIds: string[];

  // Optional - Paths
  claudeWorkingDir?: string;
  stateDir: string;

  // Optional - Security filters
  blockedCommands: string[];
  confirmCommands: string[];
  maxPromptLength: number;

  // Optional - Session management
  maxActiveSessions: number;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
  staleSessionMs: number;

  // Optional - Notification
  notificationDelaySeconds: number;

  // Optional - Polling
  pollIntervalMs: number;

  // Optional - Execution queue
  maxConcurrentExecutions: number;
  maxQueueSize: number;
  executionTimeoutMs: number;

  // Optional - Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Default values for optional wizard config fields.
 */
export const WIZARD_DEFAULTS: Omit<
  WizardConfig,
  | 'slackBotToken'
  | 'slackAppToken'
  | 'slackSigningSecret'
  | 'slackChannelId'
  | 'allowedUserIds'
  | 'allowedChannelIds'
> = {
  stateDir: './state',
  blockedCommands: [
    'rm -rf',
    'format',
    'del /f',
    'DROP TABLE',
    'DROP DATABASE',
  ],
  confirmCommands: [
    'git push',
    'git reset',
    'database migration',
    'delete',
    'remove',
  ],
  maxPromptLength: 2000,
  maxActiveSessions: 10,
  sessionTimeoutMs: 3600000,
  heartbeatIntervalMs: 30000,
  staleSessionMs: 300000,
  notificationDelaySeconds: 300,
  pollIntervalMs: 2000,
  maxConcurrentExecutions: 1,
  maxQueueSize: 5,
  executionTimeoutMs: 600000,
  logLevel: 'info',
};

/**
 * Hook event configuration in settings.local.json
 */
export interface HookEntry {
  type: 'command';
  command: string;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

/**
 * Structure of .claude/settings.local.json
 */
export interface SettingsLocalJson {
  permissions: {
    allow: string[];
  };
  hooks: {
    PreToolUse: HookMatcher[];
    PostToolUse: HookMatcher[];
    Notification: HookMatcher[];
    Stop: HookMatcher[];
  };
  enabledPlugins?: Record<string, boolean>;
}

/**
 * Slack auth.test API response
 */
export interface SlackAuthTestResponse {
  ok: boolean;
  error?: string;
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
}

/**
 * Slack conversations.info API response
 */
export interface SlackConversationsInfoResponse {
  ok: boolean;
  error?: string;
  channel?: {
    id: string;
    name: string;
    is_member: boolean;
  };
}

/**
 * Validation result from Slack API calls
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: Record<string, string>;
}

/**
 * Wizard server mode
 */
export type WizardMode = 'fresh' | 'existing';
