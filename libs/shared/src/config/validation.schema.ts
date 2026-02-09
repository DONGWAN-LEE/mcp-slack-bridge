import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Required - Slack
  SLACK_BOT_TOKEN: Joi.string().pattern(/^xoxb-/).required().messages({
    'any.required':
      'SLACK_BOT_TOKEN is required. Get it from https://api.slack.com/apps',
    'string.pattern.base':
      'SLACK_BOT_TOKEN must start with "xoxb-"',
  }),
  SLACK_APP_TOKEN: Joi.string().pattern(/^xapp-/).required().messages({
    'any.required':
      'SLACK_APP_TOKEN is required. Get it from https://api.slack.com/apps',
    'string.pattern.base':
      'SLACK_APP_TOKEN must start with "xapp-"',
  }),
  SLACK_SIGNING_SECRET: Joi.string().optional().default(''),
  SLACK_CHANNEL_ID: Joi.string().pattern(/^C/).required().messages({
    'any.required':
      'SLACK_CHANNEL_ID is required. Right-click channel in Slack to get the ID.',
    'string.pattern.base':
      'SLACK_CHANNEL_ID must start with "C"',
  }),

  // Required - Security
  ALLOWED_USER_IDS: Joi.string().required().messages({
    'any.required':
      'ALLOWED_USER_IDS is required. Comma-separated Slack user IDs.',
  }),

  // Optional - Security
  ALLOWED_CHANNEL_IDS: Joi.string().optional().default(''),
  BLOCKED_COMMANDS: Joi.string()
    .optional()
    .default('rm -rf,format,del /f,DROP TABLE,DROP DATABASE'),
  CONFIRM_COMMANDS: Joi.string()
    .optional()
    .default('git push,git reset,database migration,delete,remove'),
  MAX_PROMPT_LENGTH: Joi.number().integer().min(100).max(10000).default(2000),

  // Optional - Paths
  CLAUDE_WORKING_DIR: Joi.string().optional().default(''),
  STATE_DIR: Joi.string().optional().default('./state'),

  // Optional - Session
  MAX_ACTIVE_SESSIONS: Joi.number().integer().min(1).max(100).default(10),
  SESSION_TIMEOUT_MS: Joi.number().integer().min(60000).default(3600000),
  HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(5000).default(30000),
  STALE_SESSION_MS: Joi.number().integer().min(60000).default(300000),

  // Optional - Notification delay
  NOTIFICATION_DELAY_SECONDS: Joi.number().integer().min(0).max(3600).default(300),

  // Optional - Polling
  POLL_INTERVAL_MS: Joi.number().integer().min(500).max(30000).default(2000),

  // Optional - Queue
  MAX_CONCURRENT_EXECUTIONS: Joi.number().integer().min(1).max(10).default(1),
  MAX_QUEUE_SIZE: Joi.number().integer().min(1).max(50).default(5),
  EXECUTION_TIMEOUT_MS: Joi.number().integer().min(30000).default(600000),

  // Optional - Logging
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
}).options({ allowUnknown: true });

/**
 * Validation schema for MCP server (fewer required fields).
 * MCP server does not need Slack tokens at startup.
 */
export const mcpValidationSchema = Joi.object({
  STATE_DIR: Joi.string().optional().default('./state'),
  HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(5000).default(30000),
  SESSION_TIMEOUT_MS: Joi.number().integer().min(60000).default(3600000),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
}).options({ allowUnknown: true });
