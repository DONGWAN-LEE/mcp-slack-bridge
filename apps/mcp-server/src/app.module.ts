import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  sessionConfig,
  pathsConfig,
} from '@app/shared';
import { mcpValidationSchema } from '@app/shared';

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
  ],
})
export class AppModule {}
