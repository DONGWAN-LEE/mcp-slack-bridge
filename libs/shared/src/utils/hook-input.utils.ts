import { HookInput } from '../types/hook.types';

/**
 * Read Hook stdin JSON input from Claude Code.
 * Claude Code passes event data as JSON via stdin.
 */
export async function readHookInput(): Promise<HookInput> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error(`Failed to parse hook input: ${e}`));
      }
    });
    process.stdin.on('error', reject);
  });
}
