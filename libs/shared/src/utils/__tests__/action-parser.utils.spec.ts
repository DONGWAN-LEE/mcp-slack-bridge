import { parseActionId, isSafePathSegment } from '../action-parser.utils';

describe('parseActionId', () => {
  describe('standard actions', () => {
    it('should parse approve action', () => {
      expect(parseActionId('approve:sess-123:q-456')).toEqual({
        action: 'approve',
        sessionId: 'sess-123',
        questionId: 'q-456',
      });
    });

    it('should parse reject action', () => {
      expect(parseActionId('reject:sess-123:q-456')).toEqual({
        action: 'reject',
        sessionId: 'sess-123',
        questionId: 'q-456',
      });
    });

    it('should parse custom_reply action', () => {
      expect(parseActionId('custom_reply:sess-123:q-456')).toEqual({
        action: 'custom_reply',
        sessionId: 'sess-123',
        questionId: 'q-456',
      });
    });
  });

  describe('option_N actions', () => {
    it('should parse option_0', () => {
      expect(parseActionId('option_0:sess-123:q-456')).toEqual({
        action: 'option_select',
        sessionId: 'sess-123',
        questionId: 'q-456',
        optionIndex: 0,
      });
    });

    it('should parse option_1', () => {
      expect(parseActionId('option_1:sess-123:q-456')).toEqual({
        action: 'option_select',
        sessionId: 'sess-123',
        questionId: 'q-456',
        optionIndex: 1,
      });
    });

    it('should parse option_99', () => {
      const result = parseActionId('option_99:sess-123:q-456');
      expect(result).toEqual({
        action: 'option_select',
        sessionId: 'sess-123',
        questionId: 'q-456',
        optionIndex: 99,
      });
    });

    it('should reject option_abc (non-numeric)', () => {
      expect(parseActionId('option_abc:sess-123:q-456')).toBeNull();
    });

    it('should reject option_ (no number)', () => {
      expect(parseActionId('option_:sess-123:q-456')).toBeNull();
    });

    it('should reject option_-1 (negative)', () => {
      expect(parseActionId('option_-1:sess-123:q-456')).toBeNull();
    });
  });

  describe('invalid formats', () => {
    it('should reject missing parts', () => {
      expect(parseActionId('approve:sess-123')).toBeNull();
      expect(parseActionId('approve')).toBeNull();
      expect(parseActionId('')).toBeNull();
    });

    it('should reject unknown action', () => {
      expect(parseActionId('unknown:sess-123:q-456')).toBeNull();
    });

    it('should reject empty sessionId', () => {
      expect(parseActionId('approve::q-456')).toBeNull();
    });

    it('should reject empty questionId', () => {
      expect(parseActionId('approve:sess-123:')).toBeNull();
    });
  });

  describe('security: path traversal prevention', () => {
    it('should reject sessionId with path traversal', () => {
      expect(parseActionId('approve:../etc:q-456')).toBeNull();
      expect(parseActionId('approve:..\\etc:q-456')).toBeNull();
    });

    it('should reject questionId with path traversal', () => {
      expect(parseActionId('approve:sess-123:../../etc')).toBeNull();
    });

    it('should reject sessionId with special characters', () => {
      expect(parseActionId('approve:sess/123:q-456')).toBeNull();
      expect(parseActionId('approve:sess 123:q-456')).toBeNull();
    });
  });
});

describe('isSafePathSegment', () => {
  it('should accept valid segments', () => {
    expect(isSafePathSegment('sess-123')).toBe(true);
    expect(isSafePathSegment('q-1234567890')).toBe(true);
    expect(isSafePathSegment('abc_def.json')).toBe(true);
  });

  it('should reject path traversal', () => {
    expect(isSafePathSegment('..')).toBe(false);
    expect(isSafePathSegment('../etc')).toBe(false);
  });

  it('should reject slashes and spaces', () => {
    expect(isSafePathSegment('a/b')).toBe(false);
    expect(isSafePathSegment('a b')).toBe(false);
  });
});
