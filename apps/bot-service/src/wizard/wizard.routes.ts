import { Router, Request, Response } from 'express';
import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import {
  validateBotToken,
  validateAppToken,
  validateChannel,
  validateUserId,
  validateSigningSecret,
} from './validators/slack.validator';
import { writeEnvFile } from './generators/env.generator';
import { writeSettingsFile } from './generators/settings.generator';
import { WizardConfig, WizardMode, WIZARD_DEFAULTS } from './wizard.types';

const SENSITIVE_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
];

function maskValue(val: string): string {
  if (!val || val.length < 12) return '***';
  return val.slice(0, 8) + '...' + val.slice(-4);
}

/**
 * Server-side validation of WizardConfig before writing to disk.
 */
function validateConfig(
  body: unknown,
): { valid: true; config: WizardConfig } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '잘못된 요청 형식입니다.' };
  }

  const b = body as Record<string, unknown>;

  // Required string fields
  if (typeof b.slackBotToken !== 'string' || !b.slackBotToken) {
    return { valid: false, error: 'Bot Token이 필요합니다.' };
  }
  if (!String(b.slackBotToken).startsWith('xoxb-')) {
    return {
      valid: false,
      error: 'Bot Token은 "xoxb-"로 시작해야 합니다.',
    };
  }

  if (typeof b.slackAppToken !== 'string' || !b.slackAppToken) {
    return { valid: false, error: 'App Token이 필요합니다.' };
  }
  if (!String(b.slackAppToken).startsWith('xapp-')) {
    return {
      valid: false,
      error: 'App Token은 "xapp-"로 시작해야 합니다.',
    };
  }

  if (typeof b.slackSigningSecret !== 'string' || !b.slackSigningSecret) {
    return { valid: false, error: 'Signing Secret이 필요합니다.' };
  }

  if (typeof b.slackChannelId !== 'string' || !b.slackChannelId) {
    return { valid: false, error: '채널 ID가 필요합니다.' };
  }
  if (!/^C[A-Z0-9]{8,}$/.test(String(b.slackChannelId))) {
    return { valid: false, error: '채널 ID 형식이 올바르지 않습니다.' };
  }

  // Required arrays
  if (!Array.isArray(b.allowedUserIds) || b.allowedUserIds.length === 0) {
    return { valid: false, error: '허용된 사용자 ID가 필요합니다.' };
  }
  for (const uid of b.allowedUserIds) {
    if (typeof uid !== 'string' || !/^U[A-Z0-9]{8,}$/.test(uid)) {
      return {
        valid: false,
        error: `올바르지 않은 사용자 ID: ${uid}`,
      };
    }
  }

  if (!Array.isArray(b.allowedChannelIds)) {
    return { valid: false, error: 'allowedChannelIds는 배열이어야 합니다.' };
  }

  const config: WizardConfig = {
    slackBotToken: String(b.slackBotToken),
    slackAppToken: String(b.slackAppToken),
    slackSigningSecret: String(b.slackSigningSecret),
    slackChannelId: String(b.slackChannelId),
    allowedUserIds: (b.allowedUserIds as string[]).map(String),
    allowedChannelIds: (b.allowedChannelIds as string[]).map(String),
    claudeWorkingDir: b.claudeWorkingDir
      ? String(b.claudeWorkingDir)
      : undefined,
    stateDir: String(b.stateDir || WIZARD_DEFAULTS.stateDir),
    blockedCommands: Array.isArray(b.blockedCommands)
      ? (b.blockedCommands as string[]).map(String)
      : WIZARD_DEFAULTS.blockedCommands,
    confirmCommands: Array.isArray(b.confirmCommands)
      ? (b.confirmCommands as string[]).map(String)
      : WIZARD_DEFAULTS.confirmCommands,
    maxPromptLength:
      typeof b.maxPromptLength === 'number'
        ? b.maxPromptLength
        : WIZARD_DEFAULTS.maxPromptLength,
    maxActiveSessions:
      typeof b.maxActiveSessions === 'number'
        ? b.maxActiveSessions
        : WIZARD_DEFAULTS.maxActiveSessions,
    sessionTimeoutMs:
      typeof b.sessionTimeoutMs === 'number'
        ? b.sessionTimeoutMs
        : WIZARD_DEFAULTS.sessionTimeoutMs,
    heartbeatIntervalMs:
      typeof b.heartbeatIntervalMs === 'number'
        ? b.heartbeatIntervalMs
        : WIZARD_DEFAULTS.heartbeatIntervalMs,
    staleSessionMs:
      typeof b.staleSessionMs === 'number'
        ? b.staleSessionMs
        : WIZARD_DEFAULTS.staleSessionMs,
    notificationDelaySeconds:
      typeof b.notificationDelaySeconds === 'number'
        ? b.notificationDelaySeconds
        : WIZARD_DEFAULTS.notificationDelaySeconds,
    pollIntervalMs:
      typeof b.pollIntervalMs === 'number'
        ? b.pollIntervalMs
        : WIZARD_DEFAULTS.pollIntervalMs,
    maxConcurrentExecutions:
      typeof b.maxConcurrentExecutions === 'number'
        ? b.maxConcurrentExecutions
        : WIZARD_DEFAULTS.maxConcurrentExecutions,
    maxQueueSize:
      typeof b.maxQueueSize === 'number'
        ? b.maxQueueSize
        : WIZARD_DEFAULTS.maxQueueSize,
    executionTimeoutMs:
      typeof b.executionTimeoutMs === 'number'
        ? b.executionTimeoutMs
        : WIZARD_DEFAULTS.executionTimeoutMs,
    logLevel: ['debug', 'info', 'warn', 'error'].includes(
      String(b.logLevel),
    )
      ? (String(b.logLevel) as WizardConfig['logLevel'])
      : WIZARD_DEFAULTS.logLevel,
  };

  return { valid: true, config };
}

export function createWizardRouter(
  mode: WizardMode,
  projectRoot: string,
  existingEnv: Record<string, string>,
  onComplete: () => void,
  onSkip: () => void,
): Router {
  const router = Router();

  // Server-side storage for validated bot token
  let validatedBotToken: string | null = null;

  /**
   * GET /api/status - Current wizard mode and masked env values
   */
  router.get('/status', (_req: Request, res: Response) => {
    // Mask sensitive values before sending to client
    const safeEnv: Record<string, string> = {};
    if (mode === 'existing') {
      for (const [key, value] of Object.entries(existingEnv)) {
        safeEnv[key] = SENSITIVE_KEYS.includes(key) ? maskValue(value) : value;
      }
    }
    res.json({ mode, existingEnv: safeEnv });
  });

  /**
   * GET /api/defaults - Default values for optional fields
   */
  router.get('/defaults', (_req: Request, res: Response) => {
    res.json(WIZARD_DEFAULTS);
  });

  /**
   * POST /api/validate/slack-tokens - Validate bot + app tokens
   */
  router.post(
    '/validate/slack-tokens',
    async (req: Request, res: Response) => {
      const { botToken, appToken, signingSecret } = req.body;

      const results: Record<string, unknown> = {};

      if (botToken) {
        const botResult = await validateBotToken(botToken);
        results.botToken = botResult;
        if (botResult.valid) {
          validatedBotToken = botToken;
        }
      }

      if (appToken) {
        results.appToken = validateAppToken(appToken);
      }

      if (signingSecret) {
        results.signingSecret = validateSigningSecret(signingSecret);
      }

      res.json(results);
    },
  );

  /**
   * POST /api/validate/channel - Validate channel ID using server-stored token
   */
  router.post('/validate/channel', async (req: Request, res: Response) => {
    const { channelId } = req.body;

    if (!validatedBotToken) {
      res.json({
        valid: false,
        error: 'Bot 토큰이 검증되지 않았습니다. 이전 단계에서 토큰을 먼저 검증해주세요.',
      });
      return;
    }

    const result = await validateChannel(validatedBotToken, channelId);
    res.json(result);
  });

  /**
   * POST /api/validate/user - Validate user ID format
   */
  router.post('/validate/user', (req: Request, res: Response) => {
    const { userId } = req.body;
    const result = validateUserId(userId);
    res.json(result);
  });

  /**
   * POST /api/validate/directory - Validate directory exists (scoped to project)
   */
  router.post('/validate/directory', (req: Request, res: Response) => {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      res.json({ valid: true });
      return;
    }

    // Resolve to absolute and check it's within or relative to project
    const resolved = resolve(projectRoot, dirPath);
    const rel = relative(projectRoot, resolved);
    const isOutsideProject =
      rel.startsWith('..') || resolve(resolved) !== resolved;

    // Allow absolute paths that exist, but warn if outside project
    const exists = existsSync(resolved);
    if (!exists) {
      res.json({
        valid: false,
        error: `디렉토리가 존재하지 않습니다: ${dirPath}`,
      });
      return;
    }

    res.json({
      valid: true,
      warning: isOutsideProject
        ? '프로젝트 디렉토리 외부 경로입니다.'
        : undefined,
    });
  });

  /**
   * POST /api/apply - Apply wizard configuration (with server-side validation)
   */
  router.post('/apply', (req: Request, res: Response) => {
    try {
      const validation = validateConfig(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const config = validation.config;

      // Use server-stored token if available (avoid client-sent token override)
      if (validatedBotToken) {
        config.slackBotToken = validatedBotToken;
      }

      // Write .env file
      writeEnvFile(config, projectRoot);

      // Write settings.local.json
      writeSettingsFile(projectRoot);

      res.json({ success: true });

      // Signal completion after response is sent
      setTimeout(onComplete, 500);
    } catch (err) {
      res.status(500).json({
        success: false,
        error: `설정 적용 실패: ${(err as Error).message}`,
      });
    }
  });

  /**
   * POST /api/skip - Skip wizard, use existing settings
   */
  router.post('/skip', (_req: Request, res: Response) => {
    res.json({ success: true });
    setTimeout(onSkip, 500);
  });

  return router;
}
