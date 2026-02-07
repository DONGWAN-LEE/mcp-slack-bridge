import { ParsedAction } from '../types/slack.types';

const VALID_ACTIONS = new Set(['approve', 'reject', 'custom_reply']);

/**
 * Parse Slack action_id with format: "{action}:{sessionId}:{questionId}"
 * Returns null if the format is invalid.
 */
export function parseActionId(actionId: string): ParsedAction | null {
  const parts = actionId.split(':');
  if (parts.length < 3) return null;

  const [action, sessionId, questionId] = parts;
  if (!VALID_ACTIONS.has(action) || !sessionId || !questionId) return null;

  return {
    action: action as ParsedAction['action'],
    sessionId,
    questionId,
  };
}
