import {
  ValidationResult,
  SlackAuthTestResponse,
  SlackConversationsInfoResponse,
} from '../wizard.types';

const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Validate a Slack Bot Token by calling auth.test API.
 */
export async function validateBotToken(
  token: string,
): Promise<ValidationResult> {
  if (!token.startsWith('xoxb-')) {
    return {
      valid: false,
      error: 'Bot 토큰은 "xoxb-"로 시작해야 합니다.',
    };
  }

  try {
    const res = await fetch(`${SLACK_API_BASE}/auth.test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const data: SlackAuthTestResponse = await res.json();

    if (!data.ok) {
      return {
        valid: false,
        error: `Slack API 오류: ${data.error}`,
      };
    }

    return {
      valid: true,
      details: {
        team: data.team || '',
        user: data.user || '',
        botId: data.bot_id || '',
      },
    };
  } catch (err) {
    return {
      valid: false,
      error: `Slack API 연결 실패: ${(err as Error).message}`,
    };
  }
}

/**
 * Validate a Slack App Token by format check.
 * Note: xapp- tokens are used for Socket Mode (apps.connections.open),
 * which cannot be tested without establishing a WebSocket connection.
 */
export function validateAppToken(token: string): ValidationResult {
  if (!token.startsWith('xapp-')) {
    return {
      valid: false,
      error: 'App 토큰은 "xapp-"로 시작해야 합니다.',
    };
  }

  // xapp- tokens have format: xapp-{version}-{client_id}-{hash}
  const parts = token.split('-');
  if (parts.length < 4) {
    return {
      valid: false,
      error: 'App 토큰 형식이 올바르지 않습니다. (xapp-{version}-{id}-{hash})',
    };
  }

  return { valid: true };
}

/**
 * Validate a Slack channel exists and bot is a member.
 */
export async function validateChannel(
  botToken: string,
  channelId: string,
): Promise<ValidationResult> {
  if (!/^C[A-Z0-9]{8,}$/.test(channelId)) {
    return {
      valid: false,
      error: '채널 ID는 "C"로 시작하는 영숫자 문자열이어야 합니다.',
    };
  }

  try {
    const res = await fetch(
      `${SLACK_API_BASE}/conversations.info?channel=${channelId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
      },
    );
    const data: SlackConversationsInfoResponse = await res.json();

    if (!data.ok) {
      return {
        valid: false,
        error: `채널 검증 실패: ${data.error}`,
      };
    }

    if (!data.channel?.is_member) {
      return {
        valid: false,
        error: `봇이 채널 #${data.channel?.name || channelId}에 참여하지 않았습니다. 먼저 봇을 채널에 초대해주세요.`,
      };
    }

    return {
      valid: true,
      details: {
        channelName: data.channel.name,
      },
    };
  } catch (err) {
    return {
      valid: false,
      error: `Slack API 연결 실패: ${(err as Error).message}`,
    };
  }
}

/**
 * Validate Slack user ID format.
 */
export function validateUserId(userId: string): ValidationResult {
  if (!/^U[A-Z0-9]{8,}$/.test(userId)) {
    return {
      valid: false,
      error: '사용자 ID는 "U"로 시작하는 영숫자 문자열이어야 합니다.',
    };
  }
  return { valid: true };
}

/**
 * Validate signing secret format.
 */
export function validateSigningSecret(secret: string): ValidationResult {
  if (!/^[a-f0-9]{20,}$/.test(secret)) {
    return {
      valid: false,
      error: 'Signing Secret은 20자 이상의 16진수 문자열이어야 합니다.',
    };
  }
  return { valid: true };
}
