import { buildSessionsListMessage } from '../sessions-list.formatter';
import { SessionMeta } from '@app/shared/types/session.types';

describe('buildSessionsListMessage', () => {
  const channelId = 'C123';

  it('should return empty message when no sessions', () => {
    const msg = buildSessionsListMessage([], channelId);
    expect(msg.text).toContain('활성 세션 없음');
    expect(msg.blocks).toHaveLength(1);
  });

  it('should format single session', () => {
    const sessions: SessionMeta[] = [
      {
        sessionId: 'a1b2c3d4-5678-9abc-def0-123456789abc',
        environment: {
          terminal: 'vscode',
          pid: 1234,
          shell: 'powershell',
          displayName: 'VS Code',
        },
        projectPath: '/test/project',
        projectName: 'test-project',
        gitBranch: 'feature/auth',
        createdAt: '2026-02-09T14:00:00Z',
        lastActiveAt: '2026-02-09T14:05:00Z',
        status: 'active',
      },
    ];

    const msg = buildSessionsListMessage(sessions, channelId);
    expect(msg.text).toContain('1개');
    expect(msg.blocks.length).toBeGreaterThan(1);
    // Header block + divider + session block
    expect(msg.blocks[0].type).toBe('header');
    expect(msg.blocks[1].type).toBe('divider');
    expect(msg.blocks[2].type).toBe('section');
  });

  it('should show correct status icons', () => {
    const sessions: SessionMeta[] = [
      {
        sessionId: 'aaa-111',
        environment: { terminal: 'vscode', pid: 1, shell: 'powershell', displayName: 'VS Code' },
        projectPath: '/test',
        projectName: 'test',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        status: 'waiting',
      },
    ];

    const msg = buildSessionsListMessage(sessions, channelId);
    const sectionText = msg.blocks[2].text.text;
    expect(sectionText).toContain('질문 대기 중');
  });

  it('should handle multiple sessions', () => {
    const sessions: SessionMeta[] = Array(3)
      .fill(null)
      .map((_, i) => ({
        sessionId: `session-${i}`,
        environment: {
          terminal: ['vscode', 'warp', 'windows-terminal'][i] as any,
          pid: i,
          shell: 'powershell' as const,
          displayName: ['VS Code', 'Warp', 'Windows Terminal'][i],
        },
        projectPath: '/test',
        projectName: 'test',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        status: 'active' as const,
      }));

    const msg = buildSessionsListMessage(sessions, channelId);
    expect(msg.text).toContain('3개');
    // header + divider + 3 sessions
    expect(msg.blocks).toHaveLength(5);
  });
});
