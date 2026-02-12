import './utils/env-loader';
import { join } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { atomicWriteJson, ensureDir, readJsonFile } from '../libs/shared/src/utils/file.utils';
import { QuestionFile, ResponseFile } from '../libs/shared/src/types/question.types';

// Safe command prefixes that don't need Slack approval
const SAFE_PREFIXES = [
  'git ', 'npm ', 'npx ', 'node ', 'gh ', 'nest ',
  'ls', 'dir ', 'cat ', 'echo ', 'head ', 'tail ', 'wc ',
  'cd ', 'pwd', 'mkdir ', 'which ', 'where ', 'findstr ',
  'test ', 'done', 'env', 'rm ', 'cp ', 'mv ',
  'claude ', 'timeout ',
];

function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  return SAFE_PREFIXES.some((prefix) => trimmed.startsWith(prefix) || trimmed === prefix.trim());
}

async function main(): Promise<void> {
  const input = await readHookInput();
  const session = resolveSession(STATE_DIR);
  if (!session) return; // allow if no session

  const command = (input.tool_input?.command as string) || '';
  if (!command) return; // allow

  // Safe commands pass through
  if (isSafeCommand(command)) return;

  // Check if this command was previously approved via Slack
  const pendingPath = join(session.sessionDir, '.bash-pending.json');
  if (existsSync(pendingPath)) {
    try {
      const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
      if (pending.command === command && pending.questionId) {
        // Check if there's an approval response
        const responsePath = join(session.sessionDir, 'responses', `${pending.questionId}.json`);
        const response = readJsonFile<ResponseFile>(responsePath);
        if (response && (response.answer === '승인' || response.answer === 'approved')) {
          // Consume the approval
          try { unlinkSync(pendingPath); } catch { /* ignore */ }
          return; // allow
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Block and redirect to Slack for approval
  const questionId = `bash-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // Write pending file for re-execution check
  atomicWriteJson(pendingPath, { command, questionId });

  // Create question file for Slack
  const questionsDir = join(session.sessionDir, 'questions');
  ensureDir(questionsDir);

  const questionFile: QuestionFile = {
    questionId,
    sessionId: session.sessionId,
    question: `Bash 명령 실행 승인이 필요합니다:\n\`\`\`\n${command}\n\`\`\``,
    options: ['승인', '거절'],
    createdAt: new Date().toISOString(),
    timeout: 300000,
    status: 'pending',
  };

  atomicWriteJson(join(questionsDir, `${questionId}.json`), questionFile);

  const blockDecision = {
    decision: 'block',
    reason:
      `이 Bash 명령이 Slack 승인 대기 중입니다. slack_wait_response를 questionId="${questionId}"로 호출하세요. ` +
      `승인되면 동일한 Bash 명령을 다시 실행하세요.`,
  };
  console.log(JSON.stringify(blockDecision));
}

main().catch((e) => console.error('[Hook:on-bash-permission]', e)).finally(() => process.exit(0));
