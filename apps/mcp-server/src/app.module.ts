import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  sessionConfig,
  pathsConfig,
  mcpValidationSchema,
} from '@app/shared';
import { SessionModule } from './session/session.module';

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
  ],
})
export class AppModule {}
