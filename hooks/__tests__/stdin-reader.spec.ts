import { Readable } from 'stream';

describe('readHookInput', () => {
  let originalStdin: NodeJS.ReadableStream;

  beforeEach(() => {
    originalStdin = process.stdin;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });
    jest.resetModules();
  });

  function createMockStdin(data: string): Readable {
    return new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
  }

  function createErrorStdin(): Readable {
    return new Readable({
      read() {
        this.destroy(new Error('stdin error'));
      },
    });
  }

  it('should parse valid JSON from stdin', async () => {
    Object.defineProperty(process, 'stdin', { value: createMockStdin('{"tool_name":"test","message":"hello"}'), writable: true });

    const { readHookInput } = require('../utils/stdin-reader');
    const result = await readHookInput();

    expect(result.tool_name).toBe('test');
    expect(result.message).toBe('hello');
  });

  it('should return empty object on invalid JSON', async () => {
    Object.defineProperty(process, 'stdin', { value: createMockStdin('not json'), writable: true });

    const { readHookInput } = require('../utils/stdin-reader');
    const result = await readHookInput();

    expect(result).toEqual({});
  });

  it('should return empty object on empty stdin', async () => {
    Object.defineProperty(process, 'stdin', { value: createMockStdin(''), writable: true });

    const { readHookInput } = require('../utils/stdin-reader');
    const result = await readHookInput();

    expect(result).toEqual({});
  });

  it('should return empty object on stdin error', async () => {
    Object.defineProperty(process, 'stdin', { value: createErrorStdin(), writable: true });

    const { readHookInput } = require('../utils/stdin-reader');
    const result = await readHookInput();

    expect(result).toEqual({});
  });
});
