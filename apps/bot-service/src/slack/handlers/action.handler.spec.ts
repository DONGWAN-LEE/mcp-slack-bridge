jest.mock('@app/shared/utils/file.utils', () => ({
  atomicWriteJson: jest.fn(),
  readJsonFile: jest.fn(),
}));

import { ActionHandler } from './action.handler';
import { ModalHandler } from './modal.handler';
import * as fileUtils from '@app/shared/utils/file.utils';

describe('ActionHandler', () => {
  let handler: ActionHandler;
  let slackService: any;
  let modalHandler: any;
  let registeredHandler: Function;
  const pathsCfg = { stateDir: './state', workingDir: '.' };

  beforeEach(() => {
    jest.clearAllMocks();

    slackService = {
      getApp: jest.fn().mockReturnValue({
        action: jest.fn().mockImplementation((_pattern: any, fn: Function) => {
          registeredHandler = fn;
        }),
      }),
      isAllowedUser: jest.fn().mockReturnValue(true),
      getChannelId: jest.fn().mockReturnValue('C12345'),
      postMessage: jest.fn().mockResolvedValue({ ts: '111.222' }),
      updateMessage: jest.fn().mockResolvedValue(undefined),
      openView: jest.fn().mockResolvedValue(undefined),
    };

    modalHandler = {
      buildReplyModal: jest.fn().mockReturnValue({ type: 'modal' }),
    };

    handler = new ActionHandler(
      slackService,
      modalHandler as unknown as ModalHandler,
      pathsCfg as any,
    );
    handler.onModuleInit();
  });

  const createCtx = (actionId: string, userId = 'U001') => ({
    action: { action_id: actionId },
    ack: jest.fn().mockResolvedValue(undefined),
    body: {
      user: { id: userId },
      channel: { id: 'C12345' },
      message: { ts: '999.888' },
      trigger_id: 'trigger123',
    },
  });

  it('should register action handler on init', () => {
    expect(slackService.getApp().action).toHaveBeenCalledWith(
      /^(approve|reject|custom_reply):/,
      expect.any(Function),
    );
  });

  it('should write approved response and update message', async () => {
    const ctx = createCtx('approve:session-uuid:q-123');
    await registeredHandler(ctx);

    expect(ctx.ack).toHaveBeenCalled();
    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('q-123.json'),
      expect.objectContaining({ answer: 'approved', source: 'slack_button' }),
    );
    expect(slackService.updateMessage).toHaveBeenCalled();
  });

  it('should write rejected response', async () => {
    const ctx = createCtx('reject:session-uuid:q-123');
    await registeredHandler(ctx);

    expect(fileUtils.atomicWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('q-123.json'),
      expect.objectContaining({ answer: 'rejected' }),
    );
  });

  it('should open modal for custom_reply', async () => {
    (fileUtils.readJsonFile as jest.Mock).mockReturnValue({
      questionId: 'q-123',
      question: 'Deploy to production?',
    });

    const ctx = createCtx('custom_reply:session-uuid:q-123');
    await registeredHandler(ctx);

    expect(slackService.openView).toHaveBeenCalledWith(
      'trigger123',
      expect.objectContaining({ type: 'modal' }),
    );
    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });

  it('should reject unauthorized users', async () => {
    slackService.isAllowedUser.mockReturnValue(false);

    const ctx = createCtx('approve:session-uuid:q-123', 'U999');
    await registeredHandler(ctx);

    expect(ctx.ack).toHaveBeenCalled();
    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
    expect(slackService.updateMessage).not.toHaveBeenCalled();
  });

  it('should ignore invalid action_id format', async () => {
    const ctx = createCtx('invalid-format');
    await registeredHandler(ctx);

    expect(ctx.ack).toHaveBeenCalled();
    expect(fileUtils.atomicWriteJson).not.toHaveBeenCalled();
  });
});
