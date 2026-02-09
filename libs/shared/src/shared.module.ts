import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  slackConfig,
  securityConfig,
  sessionConfig,
  pollingConfig,
  queueConfig,
  pathsConfig,
} from './config/configuration';
import { validationSchema } from './config/validation.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        slackConfig,
        securityConfig,
        sessionConfig,
        pollingConfig,
        queueConfig,
        pathsConfig,
      ],
      validationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class SharedModule {}
