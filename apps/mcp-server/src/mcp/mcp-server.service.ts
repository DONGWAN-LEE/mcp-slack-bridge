import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionService } from '../session/session.service';
import { FileBridgeService } from '../bridge/file-bridge.service';
import { registerSlackAskTool } from './tools/slack-ask.tool';
import { registerSlackNotifyTool } from './tools/slack-notify.tool';
import { registerSlackWaitTool } from './tools/slack-wait.tool';

@Injectable()
export class McpServerService implements OnModuleInit, OnModuleDestroy {
  private mcpServer!: McpServer;

  constructor(
    private readonly sessionService: SessionService,
    private readonly fileBridge: FileBridgeService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.mcpServer = new McpServer(
      { name: 'mcp-slack-bridge', version: '2.0.0' },
      { capabilities: { tools: {} } },
    );

    registerSlackAskTool(this.mcpServer, this.sessionService, this.fileBridge);
    registerSlackNotifyTool(this.mcpServer, this.sessionService, this.fileBridge);
    registerSlackWaitTool(this.mcpServer, this.sessionService, this.fileBridge);

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    console.error('[MCP] Server connected via stdio');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.close();
    }
  }
}
