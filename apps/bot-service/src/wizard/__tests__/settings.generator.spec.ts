import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  generateSettings,
  writeSettingsFile,
} from '../generators/settings.generator';
import { atomicWriteJson } from '@app/shared';

const TEST_DIR = join(__dirname, '.tmp-settings-test');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('generateSettings', () => {
  it('should produce a valid SettingsLocalJson object', () => {
    const settings = generateSettings();

    expect(settings.permissions).toBeDefined();
    expect(Array.isArray(settings.permissions.allow)).toBe(true);
    expect(settings.permissions.allow.length).toBeGreaterThan(0);
  });

  it('should include default permissions', () => {
    const settings = generateSettings();
    const perms = settings.permissions.allow;

    expect(perms).toContain('Bash(git status:*)');
    expect(perms).toContain('mcp__slack-bridge__slack_notify');
    expect(perms).toContain('mcp__slack-bridge__slack_ask');
    expect(perms).toContain('WebSearch');
  });

  it('should include all 4 hook events', () => {
    const settings = generateSettings();

    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.Notification).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
  });

  it('should have correct hook command paths', () => {
    const settings = generateSettings();

    const preHook = settings.hooks.PreToolUse[0];
    expect(preHook.matcher).toBe('AskUserQuestion');
    expect(preHook.hooks[0].command).toContain('on-question-asked.js');

    const notifHook = settings.hooks.Notification[0];
    expect(notifHook.hooks[0].command).toContain('on-notification.js');
  });
});

describe('writeSettingsFile', () => {
  it('should create .claude directory and settings file', () => {
    writeSettingsFile(TEST_DIR);

    const settingsPath = join(TEST_DIR, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(content.permissions.allow).toBeDefined();
    expect(content.hooks).toBeDefined();
  });

  it('should merge with existing permissions', () => {
    // Create existing settings with custom permissions
    const claudeDir = join(TEST_DIR, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const existing = {
      permissions: {
        allow: ['CustomPermission', 'Bash(git status:*)'],
      },
      hooks: {},
    };
    atomicWriteJson(join(claudeDir, 'settings.local.json'), existing);

    writeSettingsFile(TEST_DIR);

    const settingsPath = join(claudeDir, 'settings.local.json');
    const content = JSON.parse(readFileSync(settingsPath, 'utf8'));

    // Should include both custom and default permissions
    expect(content.permissions.allow).toContain('CustomPermission');
    expect(content.permissions.allow).toContain('Bash(git status:*)');
    expect(content.permissions.allow).toContain(
      'mcp__slack-bridge__slack_notify',
    );
  });

  it('should preserve enabledPlugins from existing settings', () => {
    const claudeDir = join(TEST_DIR, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const existing = {
      permissions: { allow: [] },
      hooks: {},
      enabledPlugins: {
        'my-plugin@official': true,
      },
    };
    atomicWriteJson(join(claudeDir, 'settings.local.json'), existing);

    writeSettingsFile(TEST_DIR);

    const settingsPath = join(claudeDir, 'settings.local.json');
    const content = JSON.parse(readFileSync(settingsPath, 'utf8'));

    expect(content.enabledPlugins['my-plugin@official']).toBe(true);
  });

  it('should not have duplicate permissions after merge', () => {
    const claudeDir = join(TEST_DIR, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const existing = {
      permissions: {
        allow: ['Bash(git status:*)', 'Bash(git status:*)'],
      },
      hooks: {},
    };
    atomicWriteJson(join(claudeDir, 'settings.local.json'), existing);

    writeSettingsFile(TEST_DIR);

    const settingsPath = join(claudeDir, 'settings.local.json');
    const content = JSON.parse(readFileSync(settingsPath, 'utf8'));

    const count = content.permissions.allow.filter(
      (p: string) => p === 'Bash(git status:*)',
    ).length;
    expect(count).toBe(1);
  });
});
