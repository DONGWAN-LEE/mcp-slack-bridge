import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { AppModule } from './app.module';
import { WizardServer } from './wizard/wizard.server';
import { parseEnvFile } from './wizard/generators/env.generator';
import { WizardMode } from './wizard/wizard.types';

const WIZARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' });
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

  let mode: WizardMode;
  let existingEnv: Record<string, string> = {};

  if (hasEnv) {
    existingEnv = parseEnvFile(projectRoot);
    mode = 'existing';
  } else {
    mode = 'fresh';
  }

  const wizard = new WizardServer();

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      logger.warn(
        `Setup wizard timed out after ${WIZARD_TIMEOUT_MS / 1000}s.`,
      );
      if (hasEnv) {
        logger.log('Using existing configuration...');
        resolve();
      } else {
        reject(
          new Error(
            '.env 파일이 없고 Setup Wizard 시간이 초과되었습니다. .env.example을 참고하여 .env를 수동으로 생성해주세요.',
          ),
        );
      }
    }, WIZARD_TIMEOUT_MS);

    wizard.on('complete', () => {
      clearTimeout(timeout);
      logger.log('Setup wizard completed. Starting bot service...');

      // Re-load .env into process.env
      const newEnv = parseEnvFile(projectRoot);
      for (const [key, value] of Object.entries(newEnv)) {
        process.env[key] = value;
      }

      resolve();
    });

    wizard.on('skip', () => {
      clearTimeout(timeout);
      logger.log('Using existing configuration. Starting bot service...');
      resolve();
    });

    wizard
      .start(mode, existingEnv)
      .then(() => {
        const url = wizard.getUrl();

        if (!hasEnv) {
          logger.log(
            `\n` +
              `============================================\n` +
              `  .env 파일이 없습니다.\n` +
              `  Setup Wizard를 시작합니다.\n` +
              `  브라우저: ${url}\n` +
              `============================================`,
          );
        } else {
          logger.log(
            `\n` +
              `============================================\n` +
              `  기존 설정이 감지되었습니다.\n` +
              `  설정 변경: ${url}\n` +
              `============================================`,
          );
        }

        openBrowser(url);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

async function bootstrap() {
  const logger = new Logger('BotService');

  await checkEnvOrWizard(logger);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  logger.log('Bot service started');

  const shutdown = async () => {
    logger.log('Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
