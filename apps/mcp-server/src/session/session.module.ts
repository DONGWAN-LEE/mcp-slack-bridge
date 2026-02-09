import { Module } from '@nestjs/common';
import { EnvironmentDetector } from './environment.detector';
import { SessionService } from './session.service';

@Module({
  providers: [EnvironmentDetector, SessionService],
  exports: [SessionService],
})
export class SessionModule {}
