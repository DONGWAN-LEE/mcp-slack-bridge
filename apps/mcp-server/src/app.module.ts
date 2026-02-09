import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  sessionConfig,
  pathsConfig,
  mcpValidationSchema,
} from '@app/shared';
import { SessionModule } from './session/session.module';
import { BridgeModule } from './bridge/bridge.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [sessionConfig, pathsConfig],
      validationSchema: mcpValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    SessionModule,
    BridgeModule,
    McpModule,
  ],
})
export class AppModule {}
