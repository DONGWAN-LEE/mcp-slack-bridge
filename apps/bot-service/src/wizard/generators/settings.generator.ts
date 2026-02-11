import { join } from 'path';
import { existsSync } from 'fs';
import { SettingsLocalJson } from '../wizard.types';
// Direct sub-path import to avoid barrel export side-effect:
// @app/shared re-exports SharedModule which triggers ConfigModule.forRoot() at import time.
import { atomicWriteJson, readJsonFile, ensureDir } from '@app/shared/utils/file.utils';

const DEFAULT_PERMISSIONS: string[] = [
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git branch:*)',
  'Bash(git checkout:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git push:*)',
  'Bash(git pull:*)',
  'Bash(git remote get-url:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr list:*)',
  'Bash(gh pr view:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr edit:*)',
  'Bash(npm install:*)',
  'Bash(npm run build:all:*)',
  'Bash(npm run build:bot:*)',
  'Bash(npm run build:hooks:*)',
  'Bash(npx jest:*)',
  'Bash(npx nest build:*)',
  'Bash(npx nest start:*)',
  'Bash(npx tsc:*)',
  'Bash(node -e:*)',
  'Bash(nest:*)',
  'Bash(dir:*)',
  'Bash(ls:*)',
  'Bash(findstr:*)',
  'Bash(test:*)',
  'Bash(where:*)',
  'Bash(claude mcp:*)',
  'Bash(done)',
  'mcp__filesystem__list_directory',
  'mcp__filesystem__directory_tree',
  'mcp__filesystem__read_text_file',
  'mcp__filesystem__read_multiple_files',
  'mcp__sequential-thinking__sequentialthinking',
  'mcp__slack-bridge__slack_notify',
  'mcp__slack-bridge__slack_ask',
  'mcp__playwright__browser_navigate',
  'mcp__playwright__browser_close',
  'WebSearch',
  'WebFetch(domain:docs.slack.dev)',
  'WebFetch(domain:api.slack.com)',
];

const DEFAULT_HOOKS: SettingsLocalJson['hooks'] = {
  PreToolUse: [
    {
      matcher: 'AskUserQuestion',
      hooks: [
        {
          type: 'command',
          command: 'node dist/hooks/hooks/on-question-asked.js',
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: 'AskUserQuestion',
      hooks: [
        {
          type: 'command',
          command: 'node dist/hooks/hooks/on-question-answered.js',
        },
      ],
    },
  ],
  Notification: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node dist/hooks/hooks/on-notification.js',
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node dist/hooks/hooks/on-stop.js',
        },
      ],
    },
  ],
};

/**
 * Generate settings.local.json content.
 */
export function generateSettings(): SettingsLocalJson {
  return {
    permissions: {
      allow: [...DEFAULT_PERMISSIONS],
    },
    hooks: DEFAULT_HOOKS,
  };
}

/**
 * Write settings.local.json, merging with existing file if present.
 * Preserves user's custom permissions and enabledPlugins.
 */
export function writeSettingsFile(projectRoot: string): void {
  const claudeDir = join(projectRoot, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');

  ensureDir(claudeDir);

  const newSettings = generateSettings();

  // Merge with existing if present
  if (existsSync(settingsPath)) {
    const existing = readJsonFile<SettingsLocalJson>(settingsPath);
    if (existing) {
      // Merge permissions: keep existing custom ones, add defaults
      const existingPerms = new Set(existing.permissions?.allow || []);
      for (const perm of DEFAULT_PERMISSIONS) {
        existingPerms.add(perm);
      }
      newSettings.permissions.allow = Array.from(existingPerms);

      // Preserve enabledPlugins
      if (existing.enabledPlugins) {
        newSettings.enabledPlugins = existing.enabledPlugins;
      }
    }
  }

  atomicWriteJson(settingsPath, newSettings);
}
