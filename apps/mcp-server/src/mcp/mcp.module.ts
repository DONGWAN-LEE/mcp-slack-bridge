import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { BridgeModule } from '../bridge/bridge.module';
import { McpServerService } from './mcp-server.service';

@Module({
  imports: [SessionModule, BridgeModule],
  providers: [McpServerService],
})
export class McpModule {}
