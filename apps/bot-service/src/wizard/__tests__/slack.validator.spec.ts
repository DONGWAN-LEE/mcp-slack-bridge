import {
  validateBotToken,
  validateAppToken,
  validateChannel,
  validateUserId,
  validateSigningSecret,
} from '../validators/slack.validator';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('validateBotToken', () => {
  it('should reject token not starting with xoxb-', async () => {
    const result = await validateBotToken('invalid-token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('xoxb-');
  });

  it('should return valid with details on successful auth.test', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: true,
          team: 'MyTeam',
          user: 'bot-user',
          bot_id: 'B123',
        }),
    });

    const result = await validateBotToken('xoxb-valid-token');
    expect(result.valid).toBe(true);
    expect(result.details?.team).toBe('MyTeam');
    expect(result.details?.botId).toBe('B123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/auth.test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-valid-token',
        }),
      }),
    );
  });

  it('should return invalid on Slack API error', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: 'invalid_auth' }),
    });

    const result = await validateBotToken('xoxb-bad-token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid_auth');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await validateBotToken('xoxb-some-token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('연결 실패');
  });
});

describe('validateAppToken', () => {
  it('should reject token not starting with xapp-', () => {
    const result = validateAppToken('xoxb-wrong-prefix');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('xapp-');
  });

  it('should reject token with too few parts', () => {
    const result = validateAppToken('xapp-short');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('형식');
  });

  it('should accept valid format', () => {
    const result = validateAppToken('xapp-1-A111-222-abc123');
    expect(result.valid).toBe(true);
  });
});

describe('validateChannel', () => {
  it('should reject invalid channel ID format', async () => {
    const result = await validateChannel('xoxb-token', 'invalid');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('C');
  });

  it('should return valid when bot is a member', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: true,
          channel: { id: 'C0123456789', name: 'general', is_member: true },
        }),
    });

    const result = await validateChannel('xoxb-token', 'C0123456789');
    expect(result.valid).toBe(true);
    expect(result.details?.channelName).toBe('general');
  });

  it('should return invalid when bot is not a member', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: true,
          channel: { id: 'C0123456789', name: 'private', is_member: false },
        }),
    });

    const result = await validateChannel('xoxb-token', 'C0123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('참여하지 않았습니다');
  });

  it('should return invalid on Slack API error', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }),
    });

    const result = await validateChannel('xoxb-token', 'C0123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('channel_not_found');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));

    const result = await validateChannel('xoxb-token', 'C0123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('연결 실패');
  });
});

describe('validateUserId', () => {
  it('should accept valid user ID', () => {
    expect(validateUserId('U0123ABCDEF').valid).toBe(true);
  });

  it('should reject invalid user ID', () => {
    expect(validateUserId('invalid').valid).toBe(false);
    expect(validateUserId('C0123').valid).toBe(false);
  });
});

describe('validateSigningSecret', () => {
  it('should accept valid signing secret', () => {
    expect(
      validateSigningSecret('abcdef0123456789abcdef0123456789').valid,
    ).toBe(true);
  });

  it('should reject short secret', () => {
    expect(validateSigningSecret('abc123').valid).toBe(false);
  });

  it('should reject non-hex characters', () => {
    expect(validateSigningSecret('ghijklmnopqrstuvwxyz').valid).toBe(false);
  });
});
