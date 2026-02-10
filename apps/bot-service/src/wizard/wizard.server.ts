import { EventEmitter } from 'events';
import express, { Express } from 'express';
import { Server } from 'http';
import { join } from 'path';
import { createWizardRouter } from './wizard.routes';
import { WizardMode } from './wizard.types';

const DEFAULT_PORT = 3456;

export class WizardServer extends EventEmitter {
  private app: Express;
  private server: Server | null = null;
  private port: number;

  constructor() {
    super();
    this.port = parseInt(process.env.WIZARD_PORT || '', 10) || DEFAULT_PORT;
    this.app = express();
  }

  async start(
    mode: WizardMode,
    existingEnv?: Record<string, string>,
  ): Promise<void> {
    this.app.use(express.json());

    // Serve static files from public/
    this.app.use(express.static(join(__dirname, 'public')));

    // API routes
    const projectRoot = process.cwd();
    const router = createWizardRouter(
      mode,
      projectRoot,
      existingEnv || {},
      // onComplete callback
      () => {
        this.emit('complete');
        this.stop();
      },
      // onSkip callback
      () => {
        this.emit('skip');
        this.stop();
      },
    );
    this.app.use('/api', router);

    // SPA fallback: serve index.html for non-API routes
    this.app.get('*', (_req, res) => {
      res.sendFile(join(__dirname, 'public', 'index.html'));
    });

    return new Promise<void>((resolve, reject) => {
      this.server = this.app
        .listen(this.port, '127.0.0.1', () => {
          resolve();
        })
        .on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            reject(
              new Error(
                `포트 ${this.port}이(가) 이미 사용 중입니다. WIZARD_PORT 환경변수로 다른 포트를 지정해주세요.`,
              ),
            );
          } else {
            reject(err);
          }
        });
    });
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
