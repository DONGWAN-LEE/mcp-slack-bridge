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
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
