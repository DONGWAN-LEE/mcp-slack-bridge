import { Module } from '@nestjs/common';
import { FileBridgeService } from './file-bridge.service';

@Module({
  providers: [FileBridgeService],
  exports: [FileBridgeService],
})
export class BridgeModule {}
