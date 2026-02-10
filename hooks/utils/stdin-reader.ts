import { HookInput } from '../../libs/shared/src/types/hook.types';

export function readHookInput(): Promise<HookInput> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as HookInput);
      } catch {
        resolve({} as HookInput);
      }
    });
    process.stdin.on('error', () => {
      resolve({} as HookInput);
    });
  });
}
