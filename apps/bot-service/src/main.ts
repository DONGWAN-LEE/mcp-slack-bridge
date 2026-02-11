import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { WizardServer } from './wizard/wizard.server';
import { parseEnvFile } from './wizard/generators/env.generator';

const WIZARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// IMPORTANT: Must stay in sync with libs/shared/src/config/validation.schema.ts
// These are the Joi .required() fields. If you add a required field to the schema,
// add it here as well so the wizard can detect the missing value.
const REQUIRED_ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_CHANNEL_ID',
  'ALLOWED_USER_IDS',
];

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' });
}

function startWizard(
  wizard: WizardServer,
  logger: Logger,
  mode: 'fresh' | 'existing',
  projectRoot: string,
  existingEnv?: Record<string, string>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      logger.warn(
        `Setup wizard timed out after ${WIZARD_TIMEOUT_MS / 1000}s.`,
      );
      reject(
        new Error(
          '.env 파일이 없거나 불완전하고 Setup Wizard 시간이 초과되었습니다. .env.example을 참고하여 .env를 수동으로 생성해주세요.',
        ),
      );
    }, WIZARD_TIMEOUT_MS);

    wizard.on('complete', () => {
      clearTimeout(timeout);
      logger.log('Setup wizard completed. Starting bot service...');

      const newEnv = parseEnvFile(projectRoot);
      for (const [key, value] of Object.entries(newEnv)) {
        process.env[key] = value;
      }

      resolve();
    });

    wizard.on('skip', () => {
      clearTimeout(timeout);
      logger.warn('Setup wizard skipped by user.');
      resolve();
    });

    wizard
      .start(mode, existingEnv)
      .then(() => {
        const url = wizard.getUrl();
        const message =
          mode === 'fresh'
            ? '.env 파일이 없습니다.'
            : '.env 파일에 필수 값이 누락되어 있습니다.';

        logger.log(
          `\n` +
            `============================================\n` +
            `  ${message}\n` +
            `  Setup Wizard를 시작합니다.\n` +
            `  브라우저: ${url}\n` +
            `============================================`,
        );

        openBrowser(url);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

async function checkEnvOrWizard(logger: Logger): Promise<void> {
  // Skip wizard in production or when explicitly requested
  if (
    process.env.SKIP_WIZARD === 'true' ||
    process.env.NODE_ENV === 'production'
  ) {
    logger.log('Skipping wizard (SKIP_WIZARD or production mode)');
    return;
  }

  const projectRoot = process.cwd();
  const envPath = join(projectRoot, '.env');
  const hasEnv = existsSync(envPath);

  if (hasEnv) {
    const envValues = parseEnvFile(projectRoot);
    const missing = REQUIRED_ENV_KEYS.filter((key) => !envValues[key]);

    if (missing.length === 0) {
      logger.log(
        '.env file found with valid configuration. Skipping setup wizard.',
      );
      return;
    }

    logger.warn(
      `Missing required env vars: ${missing.join(', ')}. Starting setup wizard...`,
    );
    for (const [key, value] of Object.entries(envValues)) {
      process.env[key] = value;
    }
    const wizard = new WizardServer();
    return startWizard(wizard, logger, 'existing', projectRoot, envValues);
  }

  // .env 파일이 없으면 fresh 모드
  const wizard = new WizardServer();
  return startWizard(wizard, logger, 'fresh', projectRoot);
}

async function bootstrap() {
  const logger = new Logger('BotService');

  await checkEnvOrWizard(logger);

  // Dynamic import: AppModule is loaded AFTER wizard completes,
  // preventing ConfigModule validation from crashing before the wizard runs
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  logger.log('Bot service started');

  const shutdown = async () => {
    logger.log('Shutting down...');
    const closePromise = app.close();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown timeout')), 10000),
    );
    try {
      await Promise.race([closePromise, timeoutPromise]);
      process.exit(0);
    } catch (err) {
      logger.error(`Shutdown error: ${(err as Error).message}`);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
