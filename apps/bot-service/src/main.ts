import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseEnvFile } from './wizard/generators/env.generator';
import { WizardMode } from './wizard/wizard.types';

// IMPORTANT: Must stay in sync with libs/shared/src/config/validation.schema.ts
// These are the Joi .required() fields. If you add a required field to the schema,
// add it here as well so the wizard can detect the missing value.
const REQUIRED_ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_CHANNEL_ID',
  'ALLOWED_USER_IDS',
];

async function checkEnvOrWizard(logger: Logger): Promise<void> {
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

  let mode: WizardMode;
  let existingEnv: Record<string, string> = {};

  if (hasEnv) {
    existingEnv = parseEnvFile(projectRoot);
    const missing = REQUIRED_ENV_KEYS.filter((key) => !existingEnv[key]);

    if (missing.length === 0) {
      logger.log(
        '.env file found with valid configuration. Skipping setup wizard.',
      );
      return;
    }

    logger.warn(
      `Missing required env vars: ${missing.join(', ')}. Starting setup wizard...`,
    );
    for (const [key, value] of Object.entries(existingEnv)) {
      process.env[key] = value;
    }
    mode = 'existing';
  } else {
    mode = 'fresh';
  }

  // Dynamic import: wizard server 코드가 NestJS 모듈에 영향을 주지 않도록
  const { startWizardServer } = await import('./wizard/wizard.server');
  await startWizardServer(mode, projectRoot, existingEnv);

  logger.log('Setup wizard completed. Starting bot service...');

  // Wizard가 작성한 .env를 process.env에 주입
  const newEnv = parseEnvFile(projectRoot);
  for (const [key, value] of Object.entries(newEnv)) {
    process.env[key] = value;
  }
}

async function bootstrap() {
  const logger = new Logger('BotService');

  await checkEnvOrWizard(logger);

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
