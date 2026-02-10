import './utils/env-loader';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readHookInput } from './utils/stdin-reader';
import { resolveSession } from './utils/session-resolver';
import { STATE_DIR } from './utils/env-loader';
import { atomicWriteJson, ensureDir } from '../libs/shared/src/utils/file.utils';
import { NotificationFile } from '../libs/shared/src/types/notification.types';

async function main(): Promise<void> {
  const input = await readHookInput();
  const session = resolveSession(STATE_DIR);
  if (!session) return;

  const message = input.message;
  if (!message) return;

  const notificationId = `n-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const notificationsDir = join(session.sessionDir, 'notifications');
  ensureDir(notificationsDir);

  const notification: NotificationFile = {
    notificationId,
    sessionId: session.sessionId,
    message,
    level: 'info',
    createdAt: new Date().toISOString(),
  };

  atomicWriteJson(join(notificationsDir, `${notificationId}.json`), notification);
}

main().catch((e) => console.error('[Hook:on-notification]', e)).finally(() => process.exit(0));
