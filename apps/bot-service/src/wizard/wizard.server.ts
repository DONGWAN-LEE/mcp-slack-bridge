import * as express from 'express';
import { Express } from 'express';
import { Server } from 'http';
import { Socket } from 'net';
import { join } from 'path';
import { spawn } from 'child_process';
import { createWizardRouter } from './wizard.routes';
import { WizardMode } from './wizard.types';

const DEFAULT_PORT = 3456;
const WIZARD_TIMEOUT_MS = 5 * 60 * 1000;

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' });
}

/**
 * Setup Wizard Express 서버를 시작합니다.
 *
 * Promise를 반환하며, 사용자가 설정 완료 또는 Skip 시 resolve됩니다.
 * nestjs-vibe-engine의 startSetupServer 패턴을 따릅니다.
 */
export function startWizardServer(
  mode: WizardMode,
  projectRoot: string,
  existingEnv: Record<string, string>,
): Promise<void> {
  const port = parseInt(process.env.WIZARD_PORT || '', 10) || DEFAULT_PORT;

  return new Promise<void>((resolve, reject) => {
    const app: Express = express();
    let server: Server;
    let settled = false;
    const openSockets = new Set<Socket>();

    const timer = setTimeout(() => {
      shutdown();
      reject(
        new Error(
          '.env 파일이 없거나 불완전하고 Setup Wizard 시간이 초과되었습니다. ' +
            '.env.example을 참고하여 .env를 수동으로 생성해주세요.',
        ),
      );
    }, WIZARD_TIMEOUT_MS);

    function shutdown(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const socket of openSockets) {
        socket.destroy();
      }
      openSockets.clear();
      if (server) {
        server.close();
      }
    }

    function complete(): void {
      shutdown();
      resolve();
    }

    function onDone(): void {
      clearTimeout(timer);
      setTimeout(complete, 500);
    }

    app.use(express.json());
    app.use(express.static(join(__dirname, 'public')));

    const router = createWizardRouter(
      mode,
      projectRoot,
      existingEnv,
      onDone,
      onDone,
    );
    app.use('/api', router);

    app.get('*', (_req, res) => {
      res.sendFile(join(__dirname, 'public', 'index.html'));
    });

    server = app.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}`;
      const message =
        mode === 'fresh'
          ? '.env 파일이 없습니다.'
          : '.env 파일에 필수 값이 누락되어 있습니다.';

      console.log(
        `\n` +
          `============================================\n` +
          `  ${message}\n` +
          `  Setup Wizard를 시작합니다.\n` +
          `  브라우저: ${url}\n` +
          `============================================`,
      );

      openBrowser(url);
    });

    server.on('connection', (socket: Socket) => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `포트 ${port}이(가) 이미 사용 중입니다. WIZARD_PORT 환경변수로 다른 포트를 지정해주세요.`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}
