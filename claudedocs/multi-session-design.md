# Slack-Claude Code 멀티세션 통합 시스템 설계 문서

> 작성일: 2026-02-07
> 상태: 설계 완료, 구현 대기
> 프로젝트: mcp-slack-bridge
> 플랫폼: Windows (크로스 플랫폼 호환)
> 기반 문서: `claudedocs/slack-claude-integration-spec.md` (단일 세션 설계)

---

## 1. 시스템 개요

### 1.1 목적

기존 단일 세션 설계(`slack-claude-integration-spec.md`)를 **멀티세션**으로 확장한다.
VS Code, Warp, Windows Terminal, PowerShell 등 **다양한 실행 환경**에서 동시에 실행되는
여러 Claude Code 세션을 Slack으로 통합 관리한다.

| 기능 | 설명 | 방향 |
|------|------|------|
| **질문/허가 알림** | 세션별 질문 발생 시 Slack 알림 (환경 정보 포함) | Claude → Slack |
| **Slack 답변 → 작업 재개** | Slack 버튼/텍스트 응답이 정확한 세션으로 라우팅 | Slack → Claude |
| **원격 작업 실행** | Slack에서 프롬프트 → Claude CLI 실행 → 결과 반환 | Slack ⇄ Claude |
| **세션 관리** | 활성 세션 목록 조회, 컨텍스트 주입, 세션 종료 | Slack → Claude |

### 1.2 기존 단일 세션 설계와의 차이점

| 항목 | 단일 세션 (기존) | 멀티세션 (본 문서) |
|------|------------------|-------------------|
| 상태 파일 | `state/pending-questions.json` 단일 파일 | `state/sessions/{uuid}/` 세션별 디렉토리 |
| MCP 서버 | 1개 인스턴스 | 세션당 1개 인스턴스 (자동 생성) |
| Slack 메시지 | 플랫 메시지 | Thread-per-session + 환경 태그 |
| action_id | `approve`, `reject` 등 고정 | `approve:{sessionId}` 세션 인코딩 |
| Bot 서비스 | 단일 상태 파일 직접 참조 | `state/sessions/` 디렉토리 폴링 |
| 환경 감지 | 없음 | `TERM_PROGRAM`, `VSCODE_PID`, `WT_SESSION` 등 |
| 새 명령어 | 없음 | `/claude-sessions`, `/claude-inject` |
| Hook 설계 | 질문 감지만 (`pre_tool_execution`) | `PreToolUse`/`PostToolUse` + `Notification` + `Stop` |
| Hook 이벤트명 | `pre_tool_execution`/`post_tool_execution` (구 명칭) | `PreToolUse`/`PostToolUse` (Claude Code 공식 명칭) |
| 알림 타이밍 | 5분 타이머 후 Slack 알림 | 질문 발생 즉시 Slack 전송 (멀티세션에서 더 적합) |
| 설정 관리 | `config/security.json` 등 JSON 파일 | `.env` 파일 하나로 통합 (초보자 친화적) |

### 1.3 전체 아키텍처

```
다양한 실행 환경
├─ VS Code Terminal    → 세션 A (feature/auth) → MCP Server A → state/sessions/uuid-aaa/
├─ Warp Terminal       → 세션 B (feature/api)  → MCP Server B → state/sessions/uuid-bbb/
├─ Windows Terminal    → 세션 C (hotfix/bug)   → MCP Server C → state/sessions/uuid-ccc/
└─ PowerShell          → 세션 D (main)         → MCP Server D → state/sessions/uuid-ddd/
                                    ↕
                    Bot Service (싱글톤, 상시 실행)
                    - 2초마다 state/sessions/ 폴링
                    - 새 질문 발견 → Slack 메시지 발송 (환경 정보 포함)
                    - 버튼 응답 → 해당 세션 디렉토리에 response 기록
                                    ↕
                              Slack API (Socket Mode)
```

### 1.4 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **환경 무관** | MCP Server와 Hook은 Claude Code가 관리 → IDE/터미널 종류와 무관하게 동일 동작 |
| **세션 격리** | 각 MCP Server는 자신만의 디렉토리에 읽기/쓰기 → 동시성 문제 없음 |
| **파일 기반 IPC** | MCP ↔ Bot 통신은 파일 시스템 기반 → 프로세스 간 직접 연결 불필요 |
| **폴링 기반 감지** | Bot이 주기적으로 세션 디렉토리를 스캔 → 단순하고 신뢰성 높음 |
| **Graceful 정리** | 세션 종료/크래시 시 stale 세션 자동 정리 |

---

## 2. 실행 환경 감지 체계

### 2.1 환경변수 매핑

각 터미널/IDE는 고유한 환경변수를 설정한다. MCP 서버 시작 시 `process.env`를 읽어 실행 환경을 판별한다.

| 환경 | 감지 환경변수 | 값 예시 |
|------|--------------|---------|
| VS Code Terminal | `TERM_PROGRAM=vscode`, `VSCODE_PID` | `VSCODE_PID=12345` |
| Warp Terminal | `TERM_PROGRAM=WarpTerminal` | `WARP_IS_LOCAL_SHELL_SESSION=1` |
| Windows Terminal | `WT_SESSION` | `{guid}` |
| PowerShell | `PSModulePath` (TERM_PROGRAM 없음) | 경로 문자열 |
| iTerm2 (macOS) | `TERM_PROGRAM=iTerm.app` | `ITERM_SESSION_ID=...` |
| CMD | 없음 (기본값) | fallback → "cmd" |

### 2.2 환경 감지 함수

```typescript
interface EnvironmentInfo {
  terminal: string;       // "vscode" | "warp" | "windows-terminal" | "powershell" | "iterm" | "cmd" | "unknown"
  pid: number;            // 터미널 프로세스 ID
  shell: string;          // "powershell" | "cmd" | "bash" | "zsh"
  displayName: string;    // Slack 표시용: "VS Code (PID 12345)"
}

function detectEnvironment(): EnvironmentInfo {
  const env = process.env;

  if (env.VSCODE_PID || env.TERM_PROGRAM === 'vscode') {
    return { terminal: 'vscode', pid: Number(env.VSCODE_PID), shell: detectShell(), displayName: `VS Code (PID ${env.VSCODE_PID})` };
  }
  if (env.TERM_PROGRAM === 'WarpTerminal') {
    return { terminal: 'warp', pid: process.ppid, shell: detectShell(), displayName: 'Warp Terminal' };
  }
  if (env.WT_SESSION) {
    return { terminal: 'windows-terminal', pid: process.ppid, shell: detectShell(), displayName: `Windows Terminal (${env.WT_SESSION.slice(0, 8)})` };
  }
  if (env.TERM_PROGRAM === 'iTerm.app') {
    return { terminal: 'iterm', pid: process.ppid, shell: detectShell(), displayName: 'iTerm2' };
  }
  // PowerShell 감지: PSModulePath는 시스템 전체에 설정될 수 있으므로
  // shell 감지 결과와 결합하여 판별
  const shell = detectShell();
  if (!env.TERM_PROGRAM && shell === 'powershell') {
    return { terminal: 'powershell', pid: process.ppid, shell, displayName: 'PowerShell' };
  }
  return { terminal: 'unknown', pid: process.ppid, shell, displayName: 'Unknown Terminal' };
}

function detectShell(): string {
  // Unix: SHELL, Windows: ComSpec
  const shell = process.env.SHELL || process.env.ComSpec || '';
  if (shell.includes('pwsh') || shell.includes('powershell')) return 'powershell';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('cmd')) return 'cmd';

  // Windows 추가 감지: 부모 프로세스가 PowerShell일 수 있음
  // PSModulePath가 있고 PROMPT 환경변수가 없으면 PowerShell일 가능성 높음
  // (CMD는 PROMPT=$P$G를 기본 설정함)
  if (process.env.PSModulePath && !process.env.PROMPT) return 'powershell';

  return 'unknown';
}
```

### 2.3 환경 아이콘 매핑 (Slack 표시용)

```typescript
const TERMINAL_ICONS: Record<string, string> = {
  'vscode':           '💻',
  'warp':             '🚀',
  'windows-terminal': '🪟',
  'powershell':       '⚡',
  'iterm':            '🍎',
  'cmd':              '📟',
  'unknown':          '❓',
};
```

---

## 3. 세션 식별 체계

### 3.1 세션 ID 구성

각 MCP 서버 인스턴스는 시작 시 고유한 세션 ID를 생성한다.

```
세션 ID = UUID v4
예시: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 3.2 세션 메타데이터 (SessionMeta)

```typescript
interface SessionMeta {
  // 식별
  sessionId: string;           // UUID v4 (MCP 서버가 생성)
  claudeSessionId?: string;    // Claude Code 내부 세션 ID (있으면)

  // 환경 정보
  environment: EnvironmentInfo;

  // 프로젝트 정보
  projectPath: string;         // 작업 디렉토리 경로
  projectName: string;         // 디렉토리 이름
  gitBranch?: string;          // 현재 Git 브랜치

  // 타이밍
  createdAt: string;           // ISO 8601
  lastActiveAt: string;        // 마지막 활동 시간 (heartbeat)
  expiresAt?: string;          // 만료 시간 (설정 가능)

  // 상태
  status: 'active' | 'idle' | 'waiting' | 'terminated';

  // Slack 연동
  slackThreadTs?: string;      // Slack 스레드 타임스탬프 (thread-per-session)
}
```

### 3.3 세션 등록 흐름

```
1. Claude Code 시작 → MCP 서버 프로세스 spawn
2. MCP 서버 초기화:
   a. UUID 생성
   b. 환경 감지 (detectEnvironment)
   c. Git 브랜치 읽기
   d. state/sessions/{uuid}/ 디렉토리 생성
   e. meta.json 작성
   f. heartbeat 시작 (30초마다 lastActiveAt 갱신)
3. Bot 서비스가 폴링으로 새 세션 감지
4. Slack에 세션 시작 알림 (선택적)
```

---

## 4. 상태 관리 설계

### 4.1 디렉토리 구조 (Per-Session)

```
state/
├── sessions/
│   ├── a1b2c3d4-.../          # 세션 A
│   │   ├── meta.json          # SessionMeta
│   │   ├── heartbeat          # 빈 파일 (mtime = last heartbeat)
│   │   ├── questions/
│   │   │   ├── q-001.json     # 대기 중인 질문
│   │   │   └── q-002.json
│   │   ├── responses/
│   │   │   └── q-001.json     # Bot이 기록한 응답
│   │   └── notifications/
│   │       └── n-001.json     # 알림 메시지
│   │
│   ├── b5c6d7e8-.../          # 세션 B
│   │   ├── meta.json
│   │   ├── heartbeat
│   │   ├── questions/
│   │   ├── responses/
│   │   └── notifications/
│   │
│   └── ...
│
└── execution-queue.json       # 원격 실행 큐 (공유, 파일 락킹)
```

> **참고**: 글로벌 설정은 `config/` JSON 파일이 아닌 `.env` 환경변수로 관리한다. (섹션 13 참조)

### 4.2 질문 파일 스키마

```typescript
// state/sessions/{sessionId}/questions/q-{timestamp}.json
interface QuestionFile {
  questionId: string;          // "q-{timestamp}" 또는 UUID
  sessionId: string;           // 부모 세션 ID
  question: string;            // 질문 내용
  options?: string[];          // 선택지
  context?: string;            // 추가 컨텍스트 (현재 작업 설명)
  createdAt: string;           // ISO 8601
  timeout: number;             // 대기 시간 (ms), 기본 1800000 (30분)
  status: 'pending' | 'answered' | 'expired';
  slackMessageTs?: string;     // Slack 메시지 타임스탬프
}
```

### 4.3 응답 파일 스키마

```typescript
// state/sessions/{sessionId}/responses/q-{questionId}.json
interface ResponseFile {
  questionId: string;          // 매칭되는 질문 ID
  answer: string;              // 응답 내용
  respondedBy: string;         // Slack 유저 ID
  respondedAt: string;         // ISO 8601
  source: 'slack_button' | 'slack_text' | 'slack_inject' | 'cli';
}
```

### 4.4 Atomic Write 패턴

파일 쓰기의 원자성을 보장하기 위해 write-then-rename 패턴을 사용한다.

```typescript
import { writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');

  try {
    renameSync(tmpPath, filePath);
  } catch {
    // Windows fallback: rename이 대상 파일이 존재할 때 실패할 수 있음
    if (existsSync(filePath)) unlinkSync(filePath);
    renameSync(tmpPath, filePath);
  }
}
```

### 4.5 파일 락킹 (공유 리소스용)

`execution-queue.json` 등 여러 프로세스가 동시에 접근할 수 있는 파일에 사용한다.

```typescript
import { writeFileSync, unlinkSync, existsSync, openSync, closeSync, statSync, constants } from 'fs';

class FileLock {
  private lockPath: string;

  constructor(targetPath: string) {
    this.lockPath = `${targetPath}.lock`;
  }

  async acquire(timeoutMs: number = 5000): Promise<void> {
    const start = Date.now();
    while (true) {
      try {
        // O_CREAT | O_EXCL: 파일이 이미 존재하면 EEXIST 에러 (TOCTOU 방지)
        const fd = openSync(this.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        writeFileSync(fd, String(process.pid), 'utf8');
        closeSync(fd);
        return; // lock 획득 성공
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;

        // stale lock 감지: lock 파일이 60초 이상 오래되면 강제 해제
        try {
          const stat = statSync(this.lockPath);
          if (Date.now() - stat.mtimeMs > 60000) {
            unlinkSync(this.lockPath);
            continue;
          }
        } catch { /* lock 파일이 사라짐 → 다시 시도 */ continue; }

        if (Date.now() - start > timeoutMs) {
          throw new Error('Lock acquisition timeout');
        }
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  release(): void {
    try { unlinkSync(this.lockPath); } catch { /* 이미 삭제됨 */ }
  }
}
```

### 4.6 Heartbeat & Stale 세션 정리

```typescript
// MCP 서버 측: 30초마다 heartbeat 파일 갱신
const heartbeatInterval = setInterval(() => {
  const heartbeatPath = join(sessionDir, 'heartbeat');
  writeFileSync(heartbeatPath, '', 'utf8'); // mtime 갱신
}, 30000);

// Bot 서비스 측: 5분 이상 heartbeat 없는 세션 정리
function cleanStaleSessions(sessionsDir: string, maxAgeMs: number = 300000): void {
  const entries = readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const heartbeat = join(sessionsDir, entry.name, 'heartbeat');
    try {
      const stat = statSync(heartbeat);
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        // stale 세션 → meta.json의 status를 terminated로 변경
        const metaPath = join(sessionsDir, entry.name, 'meta.json');
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        meta.status = 'terminated';
        atomicWriteJson(metaPath, meta);
      }
    } catch {
      // heartbeat 파일 없음 → 세션 디렉토리 유효하지 않음
    }
  }
}
```

---

## 5. Slack 메시지 라우팅

### 5.1 action_id 인코딩 포맷

Slack Interactive Components의 `action_id`에 세션 ID를 인코딩하여 응답을 정확한 세션으로 라우팅한다.

```
action_id 포맷: "{action}:{sessionId}:{questionId}"

예시:
- "approve:a1b2c3d4-e5f6-7890-abcd-ef1234567890:q-1707312000000"
- "reject:a1b2c3d4-e5f6-7890-abcd-ef1234567890:q-1707312000000"
- "custom_reply:a1b2c3d4-e5f6-7890-abcd-ef1234567890:q-1707312000000"
```

### 5.2 action_id 파싱

```typescript
interface ParsedAction {
  action: 'approve' | 'reject' | 'custom_reply';
  sessionId: string;
  questionId: string;
}

function parseActionId(actionId: string): ParsedAction {
  const [action, sessionId, questionId] = actionId.split(':');
  return { action: action as ParsedAction['action'], sessionId, questionId };
}
```

### 5.3 Thread-per-Session 전략

각 세션은 Slack에서 고유한 스레드를 가진다. 같은 세션의 모든 질문/알림은 같은 스레드에 게시된다.

```
#claude-notifications 채널
│
├─ 🧵 [💻 VS Code] feature/auth (세션 A)
│   ├─ 🔔 세션 시작: 2026-02-07 14:00
│   ├─ ❓ 질문: DB 스키마 변경 허가? [승인] [거절]
│   ├─ ✅ 사용자 응답: 승인됨
│   └─ 📋 작업 완료 알림
│
├─ 🧵 [🚀 Warp] feature/api (세션 B)
│   ├─ 🔔 세션 시작: 2026-02-07 14:05
│   └─ ❓ 질문: API 엔드포인트 구조? [REST] [GraphQL]
│
└─ 🧵 [🪟 WT] hotfix/bug-123 (세션 C)
    ├─ 🔔 세션 시작: 2026-02-07 14:10
    └─ ⚠️ 에러 발생 알림
```

### 5.4 세션 시작 메시지 (스레드 루트)

```typescript
function buildSessionStartMessage(meta: SessionMeta): SlackMessage {
  const icon = TERMINAL_ICONS[meta.environment.terminal] || '❓';
  return {
    channel: process.env.SLACK_CHANNEL_ID,
    text: `${icon} 새 Claude Code 세션`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} 새 Claude Code 세션` }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*환경*: ${meta.environment.displayName}` },
          { type: 'mrkdwn', text: `*프로젝트*: ${meta.projectName}` },
          { type: 'mrkdwn', text: `*브랜치*: \`${meta.gitBranch || 'unknown'}\`` },
          { type: 'mrkdwn', text: `*세션 ID*: \`${meta.sessionId.slice(0, 8)}...\`` },
        ]
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `시작 시간: ${new Date(meta.createdAt).toLocaleString('ko-KR')}` }
        ]
      }
    ]
  };
}
```

### 5.5 질문 메시지 (스레드 응답)

```typescript
function buildQuestionMessage(meta: SessionMeta, question: QuestionFile): SlackMessage {
  const icon = TERMINAL_ICONS[meta.environment.terminal] || '❓';
  const sid = meta.sessionId;
  const qid = question.questionId;

  const elements: SlackBlockElement[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '✅ 승인' },
      style: 'primary',
      action_id: `approve:${sid}:${qid}`,
      value: 'approved'
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '❌ 거절' },
      style: 'danger',
      action_id: `reject:${sid}:${qid}`,
      value: 'rejected'
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '💬 답변 입력' },
      action_id: `custom_reply:${sid}:${qid}`
    }
  ];

  return {
    channel: process.env.SLACK_CHANNEL_ID,
    thread_ts: meta.slackThreadTs,  // 세션 스레드에 응답
    text: `${icon} 질문: ${question.question}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *[${meta.environment.displayName}] 질문 대기 중*\n\n${question.question}`
        }
      },
      ...(question.options ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*선택지*:\n${question.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
        }
      }] : []),
      { type: 'actions', elements }
    ]
  };
}
```

---

## 6. Hook 스크립트 설계

### 6.1 Hook 이벤트 매핑

| Hook 이벤트 | 용도 | 스크립트 |
|-------------|------|----------|
| `PreToolUse` (AskUserQuestion) | 질문 발생 감지 | `hooks/on-question-asked.js` |
| `PostToolUse` (AskUserQuestion) | 질문 응답 완료 감지 | `hooks/on-question-answered.js` |
| `Notification` | Claude의 일반 알림 캡처 | `hooks/on-notification.js` |
| `Stop` | 세션 종료 시 정리 | `hooks/on-stop.js` |

> **참고**: 세션 시작/종료는 Claude Code Hook이 아닌 **MCP 서버의 초기화/종료 로직**에서 처리한다.
> MCP 서버 `index.ts`에서 시작 시 세션 등록, 프로세스 종료 시 `process.on('exit')` 등으로 세션 해제를 수행한다.
> `Stop` Hook은 Claude Code가 비정상 종료되는 경우의 추가 안전장치 역할을 한다.

### 6.2 Hook 설정 (.claude/settings.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "command": "node hooks/on-question-asked.js"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "command": "node hooks/on-question-answered.js"
      }
    ],
    "Notification": [
      {
        "command": "node hooks/on-notification.js"
      }
    ],
    "Stop": [
      {
        "command": "node hooks/on-stop.js"
      }
    ]
  }
}
```

### 6.3 Hook stdin JSON 파싱

Claude Code Hooks는 stdin으로 JSON 데이터를 전달한다.

```typescript
// 공통 Hook 입력 읽기 유틸리티
async function readHookInput(): Promise<HookInput> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error(`Failed to parse hook input: ${e}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  message?: string;
}
```

### 6.4 세션 연결 (Hook → MCP Server)

Hook 스크립트는 환경변수 `MCP_SESSION_ID`를 통해 현재 세션을 식별한다.
MCP 서버가 시작 시 이 환경변수를 설정한다.

```typescript
// on-question-asked.js
const sessionId = process.env.MCP_SESSION_ID;
if (!sessionId) {
  process.exit(0); // MCP 세션 없으면 무시
}

const hookInput = await readHookInput();
const questionId = `q-${Date.now()}`;

const questionFile: QuestionFile = {
  questionId,
  sessionId,
  question: JSON.stringify(hookInput.tool_input),
  createdAt: new Date().toISOString(),
  timeout: 1800000,
  status: 'pending'
};

const questionPath = join(SESSIONS_DIR, sessionId, 'questions', `${questionId}.json`);
atomicWriteJson(questionPath, questionFile);
```

---

## 7. MCP 도구 설계

### 7.1 도구 목록

| 도구 | 설명 | 파라미터 |
|------|------|----------|
| `slack_ask` | Slack으로 질문 전송, 응답 대기 | `question`, `options?`, `timeout?` |
| `slack_notify` | Slack으로 단방향 알림 전송 | `message`, `level?` |
| `slack_wait_response` | 이전 질문의 응답 대기 | `questionId`, `timeout?` |

### 7.2 slack_ask 도구 (세션 인식)

```typescript
const slackAskTool = {
  definition: {
    name: 'slack_ask',
    description: 'Slack으로 질문을 보내고 사용자 응답을 기다립니다. 멀티세션 환경에서 현재 세션에 바인딩됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '질문 내용' },
        options: { type: 'array', items: { type: 'string' }, description: '선택지 (선택사항)' },
        timeout: { type: 'number', description: '응답 대기 시간(ms), 기본 1800000 (30분)' },
      },
      required: ['question'],
    },
  },

  async handler(args: { question: string; options?: string[]; timeout?: number }) {
    const sessionId = getSessionId(); // 현재 MCP 인스턴스의 세션 ID
    const questionId = `q-${Date.now()}`;
    const timeout = args.timeout || 1800000;

    // 1. 질문 파일 작성
    const questionFile: QuestionFile = {
      questionId,
      sessionId,
      question: args.question,
      options: args.options,
      createdAt: new Date().toISOString(),
      timeout,
      status: 'pending',
    };
    const questionPath = join(SESSIONS_DIR, sessionId, 'questions', `${questionId}.json`);
    atomicWriteJson(questionPath, questionFile);

    // 2. 응답 파일 폴링 (1초 간격)
    const responsePath = join(SESSIONS_DIR, sessionId, 'responses', `${questionId}.json`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (existsSync(responsePath)) {
        const response: ResponseFile = JSON.parse(readFileSync(responsePath, 'utf8'));
        // 질문 상태 업데이트
        questionFile.status = 'answered';
        atomicWriteJson(questionPath, questionFile);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              answer: response.answer,
              respondedBy: response.respondedBy,
              timestamp: response.respondedAt,
            }),
          }],
        };
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    // 타임아웃
    questionFile.status = 'expired';
    atomicWriteJson(questionPath, questionFile);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'timeout', message: '응답 시간 초과' }) }],
    };
  },
};
```

### 7.3 slack_notify 도구

```typescript
const slackNotifyTool = {
  definition: {
    name: 'slack_notify',
    description: 'Slack으로 단방향 알림을 보냅니다. 응답을 기다리지 않습니다.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '알림 내용' },
        level: { type: 'string', enum: ['info', 'warning', 'error'], description: '알림 레벨' },
      },
      required: ['message'],
    },
  },

  async handler(args: { message: string; level?: string }) {
    const sessionId = getSessionId();
    const notificationId = `n-${Date.now()}`;

    const notification = {
      notificationId,
      sessionId,
      message: args.message,
      level: args.level || 'info',
      createdAt: new Date().toISOString(),
    };

    const notifPath = join(SESSIONS_DIR, sessionId, 'notifications', `${notificationId}.json`);
    atomicWriteJson(notifPath, notification);

    return {
      content: [{ type: 'text', text: JSON.stringify({ sent: true, notificationId }) }],
    };
  },
};
```

---

## 8. Bot 서비스 설계

### 8.1 폴링 루프

Bot 서비스는 2초마다 `state/sessions/` 디렉토리를 스캔한다.

```typescript
class SessionPoller {
  private sessionsDir: string;
  private knownQuestions: Set<string> = new Set();
  private knownNotifications: Set<string> = new Set();
  private pollIntervalMs: number = 2000;

  async start(): Promise<void> {
    setInterval(() => this.poll(), this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    const sessions = this.getActiveSessions();

    for (const sessionId of sessions) {
      // 새 질문 감지
      const questionsDir = join(this.sessionsDir, sessionId, 'questions');
      const questions = this.readJsonFiles<QuestionFile>(questionsDir);
      for (const q of questions) {
        if (q.status === 'pending' && !this.knownQuestions.has(q.questionId)) {
          this.knownQuestions.add(q.questionId);
          await this.handleNewQuestion(sessionId, q);
        }
      }

      // 새 알림 감지
      const notifDir = join(this.sessionsDir, sessionId, 'notifications');
      const notifications = this.readJsonFiles(notifDir);
      for (const n of notifications) {
        if (!this.knownNotifications.has(n.notificationId)) {
          this.knownNotifications.add(n.notificationId);
          await this.handleNewNotification(sessionId, n);
        }
      }
    }

    // Stale 세션 정리
    cleanStaleSessions(this.sessionsDir);
  }

  private async handleNewQuestion(sessionId: string, question: QuestionFile): Promise<void> {
    const meta = this.getSessionMeta(sessionId);
    if (!meta) return;

    // 세션 스레드가 없으면 생성
    if (!meta.slackThreadTs) {
      const startMsg = await slackClient.chat.postMessage(buildSessionStartMessage(meta));
      meta.slackThreadTs = startMsg.ts;
      atomicWriteJson(join(this.sessionsDir, sessionId, 'meta.json'), meta);
    }

    // 질문 메시지 전송 (세션 스레드에)
    const msg = await slackClient.chat.postMessage(buildQuestionMessage(meta, question));
    question.slackMessageTs = msg.ts;
    atomicWriteJson(
      join(this.sessionsDir, sessionId, 'questions', `${question.questionId}.json`),
      question
    );
  }
}
```

### 8.2 Slack 액션 핸들러 (버튼 응답)

```typescript
// Bot 서비스의 action handler
slackApp.action(/^(approve|reject|custom_reply):/, async ({ action, ack, body }) => {
  await ack();

  const { action: actionType, sessionId, questionId } = parseActionId(action.action_id);

  let answer: string;
  switch (actionType) {
    case 'approve':
      answer = 'approved';
      break;
    case 'reject':
      answer = 'rejected';
      break;
    case 'custom_reply':
      // 모달 열어서 텍스트 입력 받기
      await openReplyModal(body.trigger_id, sessionId, questionId);
      return;
  }

  // 응답 파일 작성 → MCP 서버가 폴링으로 감지
  const responsePath = join(SESSIONS_DIR, sessionId, 'responses', `${questionId}.json`);
  const response: ResponseFile = {
    questionId,
    answer,
    respondedBy: body.user.id,
    respondedAt: new Date().toISOString(),
    source: 'slack_button',
  };
  atomicWriteJson(responsePath, response);

  // Slack 메시지 업데이트 (버튼 제거, 응답 표시)
  await slackClient.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `✅ 응답 완료: ${answer}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *응답 완료*: ${answer}\n_by <@${body.user.id}> at ${new Date().toLocaleString('ko-KR')}_` }
      }
    ]
  });
});
```

---

## 9. 새 Slack 명령어

### 9.1 /claude-sessions — 활성 세션 목록

```
/claude-sessions

출력:
┌─────────────────────────────────────────────────────────────┐
│ 📋 활성 Claude Code 세션 (4개)                                │
│                                                             │
│ 1. 💻 VS Code — feature/auth — a1b2...                      │
│    ⏰ 시작: 14:00 | 상태: 🟡 질문 대기 중                     │
│                                                             │
│ 2. 🚀 Warp — feature/api — b5c6...                          │
│    ⏰ 시작: 14:05 | 상태: 🟢 활성                             │
│                                                             │
│ 3. 🪟 WT — hotfix/bug-123 — c7d8...                         │
│    ⏰ 시작: 14:10 | 상태: 🔴 에러                             │
│                                                             │
│ 4. ⚡ PowerShell — main — d9e0...                            │
│    ⏰ 시작: 14:15 | 상태: 🟢 활성                             │
│                                                             │
│ [전체 새로고침]                                               │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 /claude-inject — 세션에 컨텍스트 주입

```
/claude-inject <session-id-prefix> <메시지>

예시: /claude-inject a1b2 "이 기능은 OAuth2를 사용해야 합니다"

동작:
1. session-id-prefix로 세션 매칭 (앞 4~8자리)
2. 해당 세션의 responses/ 디렉토리에 inject 파일 작성
3. MCP 서버가 inject를 감지하고 Claude Code에 컨텍스트로 전달

inject 파일 스키마:
{
  "type": "context_injection",
  "sessionId": "a1b2c3d4-...",
  "message": "이 기능은 OAuth2를 사용해야 합니다",
  "injectedBy": "U0123SLACK",
  "injectedAt": "2026-02-07T14:30:00Z"
}
```

---

## 10. 디렉토리 구조 (프로젝트 전체)

> **NestJS Monorepo 구조**: `nest new --monorepo` 기반으로 두 개의 독립 애플리케이션(`bot-service`, `mcp-server`)과
> 하나의 공유 라이브러리(`libs/shared`)로 구성한다. Hook 스크립트는 NestJS 외부에서 독립 실행되므로
> 프로젝트 루트의 `hooks/` 디렉토리에 별도 배치한다.

```
mcp-slack-bridge/
├── nest-cli.json                         # NestJS Monorepo 설정 (projects 정의)
├── package.json                          # 루트 package.json (workspace)
├── tsconfig.json                         # 루트 TypeScript 설정
├── .env                                  # 환경변수 (Slack 토큰 등)
├── .env.example                          # 환경변수 템플릿
├── .gitignore
│
├── apps/
│   ├── bot-service/                      # Slack Bot 서비스 (상시 실행, 싱글톤)
│   │   ├── src/
│   │   │   ├── main.ts                   # 진입점 (NestFactory.create)
│   │   │   ├── app.module.ts             # 루트 모듈 (SlackModule, PollerModule 임포트)
│   │   │   ├── slack/                    # Slack 연동 모듈 [Phase 3]
│   │   │   │   ├── slack.module.ts       # SlackModule 정의
│   │   │   │   ├── slack.service.ts      # Bolt 앱 초기화, Socket Mode 연결
│   │   │   │   ├── handlers/
│   │   │   │   │   ├── command.handler.ts    # /claude, /claude-sessions, /claude-inject
│   │   │   │   │   ├── action.handler.ts     # 버튼 클릭 (승인/거절) 처리
│   │   │   │   │   └── modal.handler.ts      # 텍스트 답변 모달 처리
│   │   │   │   └── formatters/
│   │   │   │       ├── session-message.formatter.ts   # 세션 시작/종료 메시지 포맷
│   │   │   │       ├── question-message.formatter.ts  # 질문 메시지 포맷 (action_id 인코딩)
│   │   │   │       └── result-message.formatter.ts    # 실행 결과 메시지 포맷
│   │   │   ├── poller/                   # 세션 폴링 모듈 [Phase 3]
│   │   │   │   ├── poller.module.ts      # PollerModule 정의
│   │   │   │   ├── poller.service.ts     # 세션 디렉토리 폴링 (2초 간격)
│   │   │   │   └── poller.scheduler.ts   # @Cron 또는 setInterval 기반 스케줄링
│   │   │   └── executor/                 # 원격 실행 모듈 [Phase 5]
│   │   │       ├── executor.module.ts    # ExecutorModule 정의
│   │   │       ├── executor.service.ts   # Claude CLI 실행 관리
│   │   │       ├── queue.service.ts      # 작업 큐 관리 (파일 락킹)
│   │   │       └── notifier.service.ts   # 알림 발송
│   │   └── tsconfig.app.json            # bot-service 전용 TS 설정
│   │
│   └── mcp-server/                       # MCP 서버 (세션당 1개 인스턴스, stdio)
│       ├── src/
│       │   ├── main.ts                   # 진입점 (stdio 기반 MCP 서버 부트스트랩)
│       │   ├── app.module.ts             # 루트 모듈 (SessionModule, McpModule 임포트)
│       │   ├── session/                  # 세션 관리 모듈 [Phase 1]
│       │   │   ├── session.module.ts     # SessionModule 정의
│       │   │   ├── session.service.ts    # 세션 생성, 환경 감지, heartbeat
│       │   │   └── environment.detector.ts  # 터미널/IDE 환경 감지
│       │   ├── mcp/                      # MCP 도구 모듈 [Phase 2]
│       │   │   ├── mcp.module.ts         # McpModule 정의
│       │   │   ├── tools/
│       │   │   │   ├── slack-ask.tool.ts      # slack_ask 도구 (세션 인식)
│       │   │   │   ├── slack-notify.tool.ts   # slack_notify 도구
│       │   │   │   └── slack-wait.tool.ts     # slack_wait_response 도구
│       │   │   └── mcp-server.provider.ts     # @modelcontextprotocol/sdk 래퍼
│       │   └── bridge/                   # 파일 기반 IPC 모듈 [Phase 2]
│       │       ├── bridge.module.ts      # BridgeModule 정의
│       │       └── file-bridge.service.ts    # 질문/응답 파일 읽기쓰기
│       └── tsconfig.app.json            # mcp-server 전용 TS 설정
│
├── libs/
│   └── shared/                           # 공유 라이브러리
│       └── src/
│           ├── index.ts                  # 배럴 export (모든 공개 API)
│           ├── shared.module.ts          # SharedModule (ConfigModule 포함)
│           ├── config/                   # 설정 관리 (@nestjs/config 기반)
│           │   ├── configuration.ts      # registerAs() 팩토리 (slack, security, session 등)
│           │   └── validation.schema.ts  # Joi 스키마 (환경변수 타입/필수값 검증)
│           ├── types/                    # 공유 TypeScript 타입
│           │   ├── session.types.ts      # SessionMeta, EnvironmentInfo
│           │   ├── question.types.ts     # QuestionFile, ResponseFile
│           │   ├── notification.types.ts # NotificationFile
│           │   ├── slack.types.ts        # ParsedAction, SlackMessage, ContextInjection
│           │   └── hook.types.ts         # HookInput, HookOutput
│           ├── utils/                    # 공유 유틸리티
│           │   ├── file.utils.ts         # Atomic write, 파일 락킹 (FileLock)
│           │   ├── action-parser.utils.ts    # action_id 인코딩/파싱
│           │   └── hook-input.utils.ts       # Hook stdin JSON 파싱
│           └── constants/                # 상수 정의
│               └── terminal-icons.ts     # TERMINAL_ICONS 매핑
│
├── hooks/                                # Claude Code Hook 스크립트 (NestJS 외부, 독립 실행)
│   ├── tsconfig.hooks.json               # Hook 전용 TS 설정 (libs/shared 참조)
│   ├── on-question-asked.ts              # PreToolUse: 질문 감지 [Phase 4]
│   ├── on-question-answered.ts           # PostToolUse: 응답 완료 감지 [Phase 4]
│   ├── on-notification.ts                # Notification: 알림 캡처 [Phase 4]
│   └── on-stop.ts                        # Stop: 세션 정리 [Phase 4]
│
├── state/                                # 런타임 상태 (gitignore)
│   ├── sessions/                         # 세션별 디렉토리 (동적 생성)
│   └── execution-queue.json              # 원격 실행 큐 (공유)
│
├── claudedocs/                           # 설계 문서
│   ├── slack-claude-integration-spec.md  # 기존 단일 세션 설계
│   └── multi-session-design.md           # 본 문서 (멀티세션 설계)
│
└── .claude/
    └── agents/                           # Claude Code 에이전트 정의
        ├── architect.md                  # 아키텍처 설계 전문
        ├── mcp-expert.md                 # MCP 프로토콜 전문
        ├── slack-expert.md               # Slack API 전문
        ├── scaffolder.md                 # 스캐폴딩 전문
        ├── session-specialist.md         # 세션 관리 전문 (새로 추가)
        └── hooks-specialist.md           # Hooks 통합 전문 (새로 추가)
```

> **Hook 스크립트가 NestJS 외부에 있는 이유**: Hook은 Claude Code가 직접 `node hooks/on-*.js` 명령으로
> 실행하는 단발성 스크립트다. NestJS의 DI 컨테이너나 모듈 시스템이 필요하지 않으며, 부트스트랩 오버헤드 없이
> 즉시 실행되어야 한다. `libs/shared/src/`의 타입과 유틸리티만 import하여 사용한다.

---

## 11. 타입 정의

### 11.1 핵심 인터페이스

```typescript
// libs/shared/src/types/session.types.ts

export interface EnvironmentInfo {
  terminal: 'vscode' | 'warp' | 'windows-terminal' | 'powershell' | 'iterm' | 'cmd' | 'unknown';
  pid: number;
  shell: 'powershell' | 'cmd' | 'bash' | 'zsh' | 'unknown';
  displayName: string;
}

export interface SessionMeta {
  sessionId: string;
  claudeSessionId?: string;
  environment: EnvironmentInfo;
  projectPath: string;
  projectName: string;
  gitBranch?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt?: string;
  status: 'active' | 'idle' | 'waiting' | 'terminated';
  slackThreadTs?: string;
}

// libs/shared/src/types/question.types.ts

export interface QuestionFile {
  questionId: string;
  sessionId: string;
  question: string;
  options?: string[];
  context?: string;
  createdAt: string;
  timeout: number;
  status: 'pending' | 'answered' | 'expired';
  slackMessageTs?: string;
}

export interface ResponseFile {
  questionId: string;
  answer: string;
  respondedBy: string;
  respondedAt: string;
  source: 'slack_button' | 'slack_text' | 'slack_inject' | 'cli';
}

// libs/shared/src/types/notification.types.ts

export interface NotificationFile {
  notificationId: string;
  sessionId: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  createdAt: string;
  slackMessageTs?: string;
}

// libs/shared/src/types/slack.types.ts

export interface ParsedAction {
  action: 'approve' | 'reject' | 'custom_reply';
  sessionId: string;
  questionId: string;
}

export interface ContextInjection {
  type: 'context_injection';
  sessionId: string;
  message: string;
  injectedBy: string;
  injectedAt: string;
}
```

---

## 12. 구현 순서 (Phase 0~6)

### Phase 0: 프로젝트 기반 구축
```
1. NestJS Monorepo 초기화
   - nest new mcp-slack-bridge --package-manager npm
   - nest generate app bot-service
   - nest generate app mcp-server
   - nest generate library shared
   - nest-cli.json에 monorepo 프로젝트 등록
2. 의존성 설치
   - NestJS: @nestjs/common, @nestjs/core, @nestjs/config, @nestjs/platform-express
   - 외부: @slack/bolt, @modelcontextprotocol/sdk, uuid, tree-kill, joi
   - 런타임: reflect-metadata, rxjs
3. .env.example 작성 (전체 설정 템플릿)
4. 공유 라이브러리 구현 (libs/shared/src/)
   - config/configuration.ts: @nestjs/config registerAs() 팩토리
   - config/validation.schema.ts: Joi 스키마 (환경변수 검증)
   - types/*.types.ts: 공유 타입 정의
   - utils/file.utils.ts: Atomic write, 파일 락킹
   - utils/action-parser.utils.ts: action_id 인코딩/파싱
   - utils/hook-input.utils.ts: Hook stdin 파싱
   - constants/terminal-icons.ts: 환경 아이콘 매핑
   - shared.module.ts: SharedModule (ConfigModule.forRoot 포함)
   - index.ts: 배럴 export
5. state/ 디렉토리 구조 생성 및 .gitignore 설정
6. hooks/tsconfig.hooks.json 작성 (libs/shared 경로 참조)
7. 빌드 스크립트 설정 (nest build bot-service / nest build mcp-server)
```

### Phase 1: 세션 관리 코어
```
1. apps/mcp-server/src/session/session.service.ts 구현
   - 세션 생성 (UUID), 환경 감지, heartbeat 관리
2. apps/mcp-server/src/session/environment.detector.ts 구현
   - detectEnvironment(), detectShell() 로직
3. apps/mcp-server/src/session/session.module.ts 모듈 정의
4. libs/shared/src/utils/file.utils.ts 구현 (atomic write, FileLock)
5. 세션 디렉토리 구조 자동 생성 로직
6. 세션 등록/해제 수명주기
7. 단위 테스트: 세션 생성 -> heartbeat -> 정리
```

### Phase 2: MCP 서버 (세션 인식)
```
1. apps/mcp-server/src/main.ts 구현 (stdio 기반 MCP 서버 부트스트랩)
2. apps/mcp-server/src/app.module.ts 구현 (SessionModule, McpModule, BridgeModule 임포트)
3. apps/mcp-server/src/mcp/tools/slack-ask.tool.ts 구현 (파일 기반 질문/응답)
4. apps/mcp-server/src/mcp/tools/slack-notify.tool.ts 구현
5. apps/mcp-server/src/bridge/file-bridge.service.ts 구현
6. apps/mcp-server/src/mcp/mcp-server.provider.ts 구현 (SDK 래퍼)
7. Claude Code에 MCP 서버 등록 테스트
```

### Phase 3: Bot 서비스 (폴링 기반)
```
1. apps/bot-service/src/main.ts 구현 (NestFactory.create + Bolt 앱 초기화)
2. apps/bot-service/src/app.module.ts 구현 (SlackModule, PollerModule 임포트)
3. apps/bot-service/src/poller/poller.service.ts 구현 (세션 디렉토리 폴링)
4. apps/bot-service/src/slack/formatters/*.formatter.ts 구현 (메시지 포맷팅)
5. apps/bot-service/src/slack/handlers/action.handler.ts 구현 (버튼 응답 -> 파일 쓰기)
6. Slack 연결 + 폴링 통합 테스트
```

### Phase 4: Hook 스크립트
```
1. hooks/on-question-asked.ts 구현
2. hooks/on-question-answered.ts 구현
3. hooks/on-notification.ts 구현
4. hooks/on-stop.ts 구현
5. hooks/tsconfig.hooks.json으로 빌드 확인
6. Claude Code Hook 등록 (.claude/settings.json) 및 테스트
```

### Phase 5: Slack 명령어 확장
```
1. /claude-sessions 명령어 구현 (apps/bot-service/src/slack/handlers/command.handler.ts)
2. /claude-inject 명령어 구현
3. /claude, /claude-status, /claude-cancel 기존 명령어 세션 인식 업데이트
4. apps/bot-service/src/executor/executor.service.ts 구현 (원격 실행)
5. apps/bot-service/src/executor/queue.service.ts 구현 (작업 큐, 파일 락킹)
```

### Phase 6: 안정화 및 배포
```
1. Stale 세션 자동 정리 로직 강화
2. 에러 핸들링 및 복구 전략 구현
3. pm2 또는 Windows Service로 Bot 서비스 상시 실행
4. 로깅 및 모니터링 설정
5. 보안 검증 (권한, 금지 명령어, 토큰 보호)
6. 통합 테스트 및 문서화
```

---

## 13. 설정 및 보안 설계

> **설계 원칙**: 모든 설정은 `.env` 파일 하나에서 관리한다.
> JSON 설정 파일 없이 `.env`만 편집하면 시스템이 동작한다.
> 초보자도 `.env.example`을 복사하고 값만 채우면 바로 사용할 수 있다.

### 13.1 `.env.example` (전체 설정 템플릿)

프로젝트 루트에 `.env.example` 파일을 제공한다. 사용자는 이 파일을 `.env`로 복사하고 값만 채우면 된다.

```bash
# ============================================================
# Slack-Claude Code 멀티세션 통합 시스템 설정
# ============================================================
# 사용법:
#   1. 이 파일을 .env로 복사:  cp .env.example .env
#   2. 아래 값들을 본인 환경에 맞게 수정
#   3. Bot 서비스 시작:  npm run start:bot
# ============================================================

# -----------------------------------------------------------
# [필수] Slack 연결 설정
# -----------------------------------------------------------
# Slack App 생성 후 발급받는 토큰들
# 발급 방법: https://api.slack.com/apps → 앱 생성 → OAuth & Permissions
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here

# 알림을 보낼 Slack 채널 ID
# 채널 ID 확인: Slack에서 채널 우클릭 → "채널 세부정보" → 맨 아래 ID
SLACK_CHANNEL_ID=C0123456789

# -----------------------------------------------------------
# [필수] 보안 설정
# -----------------------------------------------------------
# 봇 사용이 허용된 Slack 유저 ID (콤마로 구분)
# 유저 ID 확인: Slack에서 프로필 클릭 → ⋮ → "멤버 ID 복사"
ALLOWED_USER_IDS=U0123ABC

# 봇 사용이 허용된 Slack 채널 ID (콤마로 구분, 비워두면 모든 채널 허용)
ALLOWED_CHANNEL_IDS=C0123456789

# -----------------------------------------------------------
# [선택] 작업 디렉토리
# -----------------------------------------------------------
# Claude Code가 작업할 기본 디렉토리
CLAUDE_WORKING_DIR=C:\program1\gameServer

# 상태 파일 저장 경로 (기본: ./state)
STATE_DIR=./state

# -----------------------------------------------------------
# [선택] 보안 필터
# -----------------------------------------------------------
# 차단할 위험 명령어 (콤마로 구분)
# 이 문자열이 포함된 프롬프트는 실행 거부됨
BLOCKED_COMMANDS=rm -rf,format,del /f,DROP TABLE,DROP DATABASE

# 추가 확인이 필요한 명령어 (콤마로 구분)
# 이 문자열이 포함되면 Slack에서 한번 더 확인 후 실행
CONFIRM_COMMANDS=git push,git reset,database migration,delete,remove

# Slack 원격 실행 시 최대 프롬프트 길이 (기본: 2000)
MAX_PROMPT_LENGTH=2000

# -----------------------------------------------------------
# [선택] 세션 관리
# -----------------------------------------------------------
# 동시 활성 세션 최대 개수 (기본: 10)
MAX_ACTIVE_SESSIONS=10

# 세션 타임아웃 - 밀리초 (기본: 3600000 = 1시간)
SESSION_TIMEOUT_MS=3600000

# Heartbeat 간격 - 밀리초 (기본: 30000 = 30초)
HEARTBEAT_INTERVAL_MS=30000

# Stale 세션 정리 기준 - 밀리초 (기본: 300000 = 5분)
STALE_SESSION_MS=300000

# -----------------------------------------------------------
# [선택] 폴링 설정
# -----------------------------------------------------------
# Bot 서비스가 세션 디렉토리를 스캔하는 간격 - 밀리초 (기본: 2000 = 2초)
POLL_INTERVAL_MS=2000

# -----------------------------------------------------------
# [선택] 실행 큐 설정
# -----------------------------------------------------------
# 동시 실행 작업 수 (기본: 1)
MAX_CONCURRENT_EXECUTIONS=1

# 대기 큐 최대 크기 (기본: 5)
MAX_QUEUE_SIZE=5

# 작업 실행 타임아웃 - 밀리초 (기본: 600000 = 10분)
EXECUTION_TIMEOUT_MS=600000

# -----------------------------------------------------------
# [선택] 로깅
# -----------------------------------------------------------
# 로그 레벨: debug, info, warn, error (기본: info)
LOG_LEVEL=info
```

### 13.2 환경변수 → 설정 로딩 코드

NestJS의 `@nestjs/config` 모듈과 `Joi` 검증 스키마를 사용하여 환경변수를 타입 안전하게 로딩한다.
기존의 수동 `envString()`/`envNumber()`/`envList()` 헬퍼와 `validateConfig()` 함수 대신,
`ConfigModule.forRoot()`와 `registerAs()` 팩토리 패턴을 사용한다.

#### 13.2.1 Joi 검증 스키마 (`libs/shared/src/config/validation.schema.ts`)

```typescript
import * as Joi from 'joi';

// ConfigModule.forRoot()의 validationSchema 옵션에 전달
// 앱 시작 시 자동으로 환경변수를 검증하며, 실패 시 NestJS가 부트스트랩 에러를 발생시킨다.
export const validationSchema = Joi.object({
  // [필수] Slack 연결
  SLACK_BOT_TOKEN: Joi.string().pattern(/^xoxb-/).required()
    .description('Slack Bot 토큰 (xoxb- 접두사)'),
  SLACK_APP_TOKEN: Joi.string().pattern(/^xapp-/).required()
    .description('Slack App 토큰 (xapp- 접두사)'),
  SLACK_SIGNING_SECRET: Joi.string().optional()
    .description('Slack Signing Secret'),
  SLACK_CHANNEL_ID: Joi.string().pattern(/^C/).required()
    .description('알림 채널 ID (C 접두사)'),

  // [필수] 보안
  ALLOWED_USER_IDS: Joi.string().required()
    .description('허용된 Slack 유저 ID (콤마 구분)'),
  ALLOWED_CHANNEL_IDS: Joi.string().optional().allow('')
    .description('허용된 채널 ID (콤마 구분, 비워두면 모든 채널)'),

  // [선택] 작업 디렉토리
  CLAUDE_WORKING_DIR: Joi.string().optional().default(process.cwd()),
  STATE_DIR: Joi.string().optional().default('./state'),

  // [선택] 보안 필터
  BLOCKED_COMMANDS: Joi.string().optional()
    .default('rm -rf,format,del /f,DROP TABLE,DROP DATABASE'),
  CONFIRM_COMMANDS: Joi.string().optional()
    .default('git push,git reset,database migration,delete,remove'),
  MAX_PROMPT_LENGTH: Joi.number().integer().min(100).max(10000).optional().default(2000),

  // [선택] 세션 관리
  MAX_ACTIVE_SESSIONS: Joi.number().integer().min(1).max(100).optional().default(10),
  SESSION_TIMEOUT_MS: Joi.number().integer().min(60000).optional().default(3600000),
  HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(5000).optional().default(30000),
  STALE_SESSION_MS: Joi.number().integer().min(60000).optional().default(300000),

  // [선택] 폴링
  POLL_INTERVAL_MS: Joi.number().integer().min(500).max(30000).optional().default(2000),

  // [선택] 실행 큐
  MAX_CONCURRENT_EXECUTIONS: Joi.number().integer().min(1).max(10).optional().default(1),
  MAX_QUEUE_SIZE: Joi.number().integer().min(1).max(50).optional().default(5),
  EXECUTION_TIMEOUT_MS: Joi.number().integer().min(10000).optional().default(600000),

  // [선택] 로깅
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').optional().default('info'),
});
```

#### 13.2.2 설정 팩토리 (`libs/shared/src/config/configuration.ts`)

```typescript
import { registerAs } from '@nestjs/config';

// 콤마 구분 문자열을 배열로 변환하는 내부 헬퍼
function csvToArray(value: string | undefined, fallback: string[] = []): string[] {
  if (!value) return fallback;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export const slackConfig = registerAs('slack', () => ({
  botToken: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  channelId: process.env.SLACK_CHANNEL_ID,
}));

export const securityConfig = registerAs('security', () => ({
  allowedUserIds: csvToArray(process.env.ALLOWED_USER_IDS),
  allowedChannelIds: csvToArray(process.env.ALLOWED_CHANNEL_IDS),
  blockedCommands: csvToArray(process.env.BLOCKED_COMMANDS,
    ['rm -rf', 'format', 'del /f', 'DROP TABLE', 'DROP DATABASE']),
  confirmCommands: csvToArray(process.env.CONFIRM_COMMANDS,
    ['git push', 'git reset', 'database migration', 'delete', 'remove']),
  maxPromptLength: parseInt(process.env.MAX_PROMPT_LENGTH || '2000', 10),
}));

export const sessionConfig = registerAs('session', () => ({
  maxActive: parseInt(process.env.MAX_ACTIVE_SESSIONS || '10', 10),
  timeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000', 10),
  heartbeatMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
  staleMs: parseInt(process.env.STALE_SESSION_MS || '300000', 10),
}));

export const pollerConfig = registerAs('poller', () => ({
  intervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
}));

export const queueConfig = registerAs('queue', () => ({
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '1', 10),
  maxSize: parseInt(process.env.MAX_QUEUE_SIZE || '5', 10),
  timeoutMs: parseInt(process.env.EXECUTION_TIMEOUT_MS || '600000', 10),
}));

export const pathsConfig = registerAs('paths', () => ({
  workingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
  stateDir: process.env.STATE_DIR || './state',
}));
```

#### 13.2.3 SharedModule에서 ConfigModule 통합 (`libs/shared/src/shared.module.ts`)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './config/validation.schema';
import {
  slackConfig, securityConfig, sessionConfig,
  pollerConfig, queueConfig, pathsConfig,
} from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,                    // 모든 모듈에서 별도 import 없이 사용 가능
      envFilePath: '.env',               // 프로젝트 루트의 .env 파일 로드
      validationSchema,                  // Joi 스키마로 시작 시 자동 검증
      validationOptions: {
        allowUnknown: true,              // .env에 정의되지 않은 환경변수 허용
        abortEarly: false,               // 모든 검증 오류를 한번에 출력
      },
      load: [                            // registerAs() 팩토리 등록
        slackConfig,
        securityConfig,
        sessionConfig,
        pollerConfig,
        queueConfig,
        pathsConfig,
      ],
    }),
  ],
  exports: [ConfigModule],
})
export class SharedModule {}
```

#### 13.2.4 설정 사용 예시

```typescript
// 기존 방식 (제거됨)
// ❌ import { CONFIG } from '../shared/config';
// ❌ if (CONFIG.security.allowedUserIds.includes(userId)) { ... }
// ❌ validateConfig(); // 수동 검증 호출

// NestJS @nestjs/config 방식
// ✅ ConfigService DI 주입으로 타입 안전하게 접근
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SlackGuard {
  constructor(private configService: ConfigService) {}

  isAllowedUser(userId: string): boolean {
    const allowedIds = this.configService.get<string[]>('security.allowedUserIds');
    return allowedIds.includes(userId);
  }

  getChannelId(): string {
    return this.configService.get<string>('slack.channelId');
  }

  getSessionTimeout(): number {
    return this.configService.get<number>('session.timeoutMs');
  }
}
// 환경변수 검증은 ConfigModule.forRoot()의 validationSchema가
// 앱 부트스트랩 시 자동 수행한다. 필수값 누락 시 NestJS가 에러 메시지와 함께 종료한다.
```

### 13.3 설정 사용 예시

```typescript
// 기존 JSON 참조 방식 (제거됨)
// ❌ const security = JSON.parse(readFileSync('config/security.json', 'utf8'));
// ❌ if (security.allowedSlackUsers.includes(userId)) { ... }

// 새 NestJS ConfigService 방식
// ✅ constructor(private configService: ConfigService) {}
// ✅ const allowed = this.configService.get<string[]>('security.allowedUserIds');
// ✅ if (allowed.includes(userId)) { ... }
```

### 13.4 세션 보안

| 위협 | 대응 |
|------|------|
| 세션 ID 추측 | UUID v4 사용 (122비트 엔트로피) |
| Stale 세션 공격 | heartbeat 타임아웃 + 자동 정리 (`STALE_SESSION_MS`) |
| 파일 시스템 경쟁 조건 | Atomic write + 파일 락킹 |
| 환경변수 유출 | `.env` gitignore + 토큰 최소 권한 |
| 무한 세션 생성 | `MAX_ACTIVE_SESSIONS` 환경변수로 제한 (기본 10) |
| 응답 위조 | Slack User ID 검증 + `ALLOWED_USER_IDS` 환경변수 |
| 위험 명령어 | `BLOCKED_COMMANDS` 환경변수로 차단 목록 관리 |
| 설정 미입력 | Joi 검증 스키마가 부트스트랩 시 필수값 누락을 자동 감지하여 에러 출력 |

---

## 14. 에러 핸들링

### 14.1 에러 분류

| 등급 | 에러 유형 | 처리 방법 |
|------|----------|----------|
| 🔴 CRITICAL | Slack 연결 실패, 파일 시스템 오류 | 즉시 재연결/재시도 + 로그 |
| 🟡 WARNING | 세션 heartbeat 누락, 질문 타임아웃 | Stale 정리 + Slack 알림 |
| 🟢 INFO | 세션 시작/종료, 정상 응답 | 로그만 기록 |

### 14.2 복구 전략

```typescript
// Bot 서비스의 에러 복구
class ErrorRecovery {
  // Slack 연결 끊김 → 지수 백오프 재연결
  async reconnectSlack(maxRetries: number = 5): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await slackApp.start();
        return;
      } catch (e) {
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('Slack reconnection failed after max retries');
  }

  // 파일 쓰기 실패 → 재시도 (3회)
  async retryFileWrite(fn: () => void, maxRetries: number = 3): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        fn();
        return;
      } catch (e) {
        if (i === maxRetries - 1) throw e;
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // 세션 디렉토리 손상 → 재생성
  repairSessionDir(sessionId: string): void {
    const sessionDir = join(SESSIONS_DIR, sessionId);
    for (const subdir of ['questions', 'responses', 'notifications']) {
      mkdirSync(join(sessionDir, subdir), { recursive: true });
    }
  }
}
```

---

## 15. 테스트 체크리스트

### Phase 1: 세션 관리
- [ ] 세션 생성 시 UUID가 고유한가
- [ ] 환경 감지가 VS Code, Warp, WT, PowerShell을 정확히 구분하는가
- [ ] heartbeat가 30초 간격으로 갱신되는가
- [ ] 5분 이상 heartbeat 없는 세션이 정리되는가

### Phase 2: MCP 서버
- [ ] MCP 서버가 세션 디렉토리를 정확히 생성하는가
- [ ] slack_ask가 질문 파일을 올바르게 작성하는가
- [ ] 응답 파일 감지 시 slack_ask가 결과를 반환하는가
- [ ] 타임아웃 시 'expired' 상태가 설정되는가

### Phase 3: Bot 서비스
- [ ] 폴링이 새 세션을 감지하는가
- [ ] 새 질문 감지 시 Slack 메시지가 발송되는가
- [ ] Thread-per-session 전략이 올바르게 동작하는가
- [ ] 버튼 클릭 시 응답 파일이 올바른 세션 디렉토리에 작성되는가

### Phase 4: Hooks
- [ ] PreToolUse Hook이 질문을 캡처하는가
- [ ] PostToolUse Hook이 응답 완료를 감지하는가
- [ ] Stop Hook이 세션을 정리하는가
- [ ] Hook 실패 시 Claude Code 세션에 영향이 없는가

### Phase 5: 명령어
- [ ] /claude-sessions가 활성 세션 목록을 반환하는가
- [ ] /claude-inject가 올바른 세션에 컨텍스트를 주입하는가
- [ ] 동시 여러 세션에서 질문/응답이 교차 오염 없이 동작하는가

---

## 16. Windows 호환성 참고

| 항목 | 주의사항 |
|------|---------|
| 경로 구분자 | `path.join()` 사용으로 자동 처리 |
| 파일 락킹 | `rename()` 기반 atomic write는 Windows에서도 동작 |
| 환경변수 | Windows는 대소문자 구분 없음 (`PATH` = `Path`) |
| 프로세스 관리 | `tree-kill` 패키지로 자식 프로세스 정리 |
| 파일 감시 | `fs.watch()`가 Windows에서도 동작하지만 폴링 방식이 더 안정적 |
| 최대 경로 길이 | Windows 260자 제한 → 세션 디렉토리 경로 주의 |

---

## 17. 의존성 목록

### 17.1 package.json

```json
{
  "name": "mcp-slack-bridge",
  "version": "2.0.0",
  "description": "Slack-Claude Code 멀티세션 통합 시스템 (NestJS Monorepo)",
  "private": true,
  "dependencies": {
    "@nestjs/common": "^10.x",
    "@nestjs/core": "^10.x",
    "@nestjs/config": "^3.x",
    "@nestjs/platform-express": "^10.x",
    "reflect-metadata": "^0.2.x",
    "rxjs": "^7.x",
    "joi": "^17.x",
    "@slack/bolt": "^3.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "uuid": "^9.x",
    "tree-kill": "^1.x"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.x",
    "@nestjs/schematics": "^10.x",
    "@nestjs/testing": "^10.x",
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "@types/uuid": "^9.x",
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "@types/jest": "^29.x",
    "ts-node": "^10.x",
    "source-map-support": "^0.5.x"
  },
  "scripts": {
    "build": "nest build",
    "build:bot": "nest build bot-service",
    "build:mcp": "nest build mcp-server",
    "build:hooks": "tsc -p hooks/tsconfig.hooks.json",
    "start:bot": "nest start bot-service",
    "start:mcp": "nest start mcp-server",
    "start:bot:dev": "nest start bot-service --watch",
    "start:bot:prod": "node dist/apps/bot-service/main.js",
    "start:mcp:prod": "node dist/apps/mcp-server/main.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "lint": "eslint \"{apps,libs}/**/*.ts\" --fix"
  }
}
```

### 17.2 nest-cli.json

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "monorepo": true,
  "root": "apps/bot-service",
  "compilerOptions": {
    "webpack": false,
    "tsConfigPath": "apps/bot-service/tsconfig.app.json"
  },
  "projects": {
    "bot-service": {
      "type": "application",
      "root": "apps/bot-service",
      "entryFile": "main",
      "sourceRoot": "apps/bot-service/src",
      "compilerOptions": {
        "tsConfigPath": "apps/bot-service/tsconfig.app.json"
      }
    },
    "mcp-server": {
      "type": "application",
      "root": "apps/mcp-server",
      "entryFile": "main",
      "sourceRoot": "apps/mcp-server/src",
      "compilerOptions": {
        "tsConfigPath": "apps/mcp-server/tsconfig.app.json"
      }
    },
    "shared": {
      "type": "library",
      "root": "libs/shared",
      "entryFile": "index",
      "sourceRoot": "libs/shared/src",
      "compilerOptions": {
        "tsConfigPath": "libs/shared/tsconfig.lib.json"
      }
    }
  }
}
```
