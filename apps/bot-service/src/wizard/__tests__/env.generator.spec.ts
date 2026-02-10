import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  generateEnvContent,
  writeEnvFile,
  parseEnvFile,
} from '../generators/env.generator';
import { WizardConfig, WIZARD_DEFAULTS } from '../wizard.types';

const TEST_DIR = join(__dirname, '.tmp-env-test');

function makeConfig(overrides?: Partial<WizardConfig>): WizardConfig {
  return {
    ...WIZARD_DEFAULTS,
    slackBotToken: 'xoxb-test-bot-token',
    slackAppToken: 'xapp-1-A111-222-abc',
    slackSigningSecret: 'abcdef0123456789abcdef',
    slackChannelId: 'C0123456789',
    allowedUserIds: ['U0123ABC'],
    allowedChannelIds: ['C0123456789'],
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('generateEnvContent', () => {
  it('should generate valid .env content with all required fields', () => {
    const config = makeConfig();
    const content = generateEnvContent(config);

    expect(content).toContain('SLACK_BOT_TOKEN=xoxb-test-bot-token');
    expect(content).toContain('SLACK_APP_TOKEN=xapp-1-A111-222-abc');
    expect(content).toContain('SLACK_SIGNING_SECRET=abcdef0123456789abcdef');
    expect(content).toContain('SLACK_CHANNEL_ID=C0123456789');
    expect(content).toContain('ALLOWED_USER_IDS=U0123ABC');
    expect(content).toContain('ALLOWED_CHANNEL_IDS=C0123456789');
  });

  it('should include default values for optional fields', () => {
    const config = makeConfig();
    const content = generateEnvContent(config);

    expect(content).toContain('STATE_DIR=./state');
    expect(content).toContain('MAX_ACTIVE_SESSIONS=10');
    expect(content).toContain('LOG_LEVEL=info');
    expect(content).toContain('POLL_INTERVAL_MS=2000');
  });

  it('should comment out CLAUDE_WORKING_DIR when not set', () => {
    const config = makeConfig({ claudeWorkingDir: undefined });
    const content = generateEnvContent(config);

    expect(content).toContain('# CLAUDE_WORKING_DIR=');
  });

  it('should include CLAUDE_WORKING_DIR when set', () => {
    const config = makeConfig({ claudeWorkingDir: '/my/project' });
    const content = generateEnvContent(config);

    expect(content).toContain('CLAUDE_WORKING_DIR=/my/project');
  });

  it('should join array values with commas', () => {
    const config = makeConfig({
      allowedUserIds: ['U111', 'U222'],
      blockedCommands: ['rm -rf', 'format'],
    });
    const content = generateEnvContent(config);

    expect(content).toContain('ALLOWED_USER_IDS=U111,U222');
    expect(content).toContain('BLOCKED_COMMANDS=rm -rf,format');
  });
});

describe('writeEnvFile', () => {
  it('should create .env file in project root', () => {
    const config = makeConfig();
    writeEnvFile(config, TEST_DIR);

    const envPath = join(TEST_DIR, '.env');
    expect(existsSync(envPath)).toBe(true);

    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('SLACK_BOT_TOKEN=xoxb-test-bot-token');
  });

  it('should backup existing .env before overwriting', () => {
    // Create an existing .env
    const envPath = join(TEST_DIR, '.env');
    const { writeFileSync } = require('fs');
    writeFileSync(envPath, 'OLD_VALUE=old', 'utf8');

    const config = makeConfig();
    writeEnvFile(config, TEST_DIR);

    // Check backup exists
    const { readdirSync } = require('fs');
    const files: string[] = readdirSync(TEST_DIR);
    const backups = files.filter((f: string) => f.startsWith('.env.backup.'));
    expect(backups.length).toBe(1);

    // Verify backup content
    const backupContent = readFileSync(join(TEST_DIR, backups[0]), 'utf8');
    expect(backupContent).toBe('OLD_VALUE=old');
  });
});

describe('parseEnvFile', () => {
  it('should return empty object when no .env exists', () => {
    const result = parseEnvFile(join(TEST_DIR, 'nonexistent'));
    expect(result).toEqual({});
  });

  it('should parse key-value pairs correctly', () => {
    const envPath = join(TEST_DIR, '.env');
    const { writeFileSync } = require('fs');
    writeFileSync(
      envPath,
      'KEY1=value1\nKEY2=value2\n# comment\n\nKEY3=value3',
      'utf8',
    );

    const result = parseEnvFile(TEST_DIR);
    expect(result).toEqual({
      KEY1: 'value1',
      KEY2: 'value2',
      KEY3: 'value3',
    });
  });

  it('should skip comments and empty lines', () => {
    const envPath = join(TEST_DIR, '.env');
    const { writeFileSync } = require('fs');
    writeFileSync(envPath, '# full comment\n\n  \nKEY=val', 'utf8');

    const result = parseEnvFile(TEST_DIR);
    expect(Object.keys(result)).toEqual(['KEY']);
  });
});
