import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // MCP server uses createApplicationContext (no HTTP)
  // NestJS logger must go to stderr to protect stdout for MCP stdio protocol
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  // MCP server: stdio protocol handler (Phase 2)
  console.error('MCP server started');

  const shutdown = async () => {
    console.error('[MCP] Shutting down...');
    const closePromise = app.close();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown timeout')), 10000),
    );
    try {
      await Promise.race([closePromise, timeoutPromise]);
      process.exit(0);
    } catch (err) {
      console.error(`[MCP] Shutdown error: ${(err as Error).message}`);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
