const mockClient = {
  chat: {
    postMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123456' }),
    update: jest.fn().mockResolvedValue({}),
  },
  views: {
    open: jest.fn().mockResolvedValue({}),
  },
};

const mockApp = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  client: mockClient,
};

jest.mock('@slack/bolt', () => ({
  App: jest.fn().mockImplementation(() => mockApp),
}));

// Must import AFTER mock is set up
import { SlackService } from './slack.service';

describe('SlackService', () => {
  let service: SlackService;

  const slackCfg = {
    botToken: 'xoxb-test',
    appToken: 'xapp-test',
    signingSecret: 'test-secret',
    channelId: 'C12345',
  };

  const secCfg = {
    allowedUserIds: ['U001', 'U002'],
    allowedChannelIds: [],
    blockedCommands: [],
    confirmCommands: [],
    maxPromptLength: 2000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SlackService(slackCfg as any, secCfg as any);
  });

  describe('onModuleInit', () => {
    it('should create Bolt App and call start()', async () => {
      await service.onModuleInit();
      expect(mockApp.start).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call stop()', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
      expect(mockApp.stop).toHaveBeenCalled();
    });
  });

  describe('postMessage', () => {
    it('should delegate to chat.postMessage and return ts', async () => {
      await service.onModuleInit();
      const result = await service.postMessage({
        channel: 'C12345',
        text: 'hello',
        blocks: [],
      });
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C12345',
        text: 'hello',
        blocks: [],
        thread_ts: undefined,
      });
      expect(result.ts).toBe('1234567890.123456');
    });
  });

  describe('updateMessage', () => {
    it('should delegate to chat.update', async () => {
      await service.onModuleInit();
      await service.updateMessage({
        channel: 'C12345',
        ts: '111.222',
        text: 'updated',
        blocks: [],
      });
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: 'C12345',
        ts: '111.222',
        text: 'updated',
        blocks: [],
      });
    });
  });

  describe('openView', () => {
    it('should delegate to views.open', async () => {
      await service.onModuleInit();
      const view = { type: 'modal' };
      await service.openView('trigger123', view);
      expect(mockClient.views.open).toHaveBeenCalledWith({
        trigger_id: 'trigger123',
        view,
      });
    });
  });

  describe('isAllowedUser', () => {
    it('should return true for allowed user', () => {
      expect(service.isAllowedUser('U001')).toBe(true);
    });

    it('should return false for non-allowed user', () => {
      expect(service.isAllowedUser('U999')).toBe(false);
    });
  });

  describe('getChannelId', () => {
    it('should return configured channel ID', () => {
      expect(service.getChannelId()).toBe('C12345');
    });
  });
});
