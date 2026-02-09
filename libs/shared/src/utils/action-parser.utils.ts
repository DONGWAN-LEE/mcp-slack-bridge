import { ParsedAction } from '../types/slack.types';

const VALID_ACTIONS = new Set(['approve', 'reject', 'custom_reply']);
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_\-\.]+$/;

/**
 * Validate that a string is safe to use as a path segment.
 * Prevents path traversal attacks (../, absolute paths, etc.)
 */
export function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT.test(value) && !value.includes('..');
}

/**
 * Parse Slack action_id with format: "{action}:{sessionId}:{questionId}"
 * Returns null if the format is invalid or contains unsafe path segments.
 */
export function parseActionId(actionId: string): ParsedAction | null {
  const parts = actionId.split(':');
  if (parts.length < 3) return null;

  const [action, sessionId, questionId] = parts;
  if (!VALID_ACTIONS.has(action) || !sessionId || !questionId) return null;

  if (!isSafePathSegment(sessionId) || !isSafePathSegment(questionId)) {
    return null;
  }

  return {
    action: action as ParsedAction['action'],
    sessionId,
    questionId,
  };
}
