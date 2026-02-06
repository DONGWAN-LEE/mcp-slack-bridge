# Slack-Claude Code 통합 시스템 설계 문서

> 작성일: 2026-02-06
> 상태: 설계 완료, 구현 대기
> 프로젝트: gameServer (VIBE_CODING_1)
> 플랫폼: Windows

---

## 1. 시스템 개요

### 1.1 목적
Claude Code와 Slack을 연동하여 다음 3가지 기능을 제공하는 시스템

| 기능 | 설명 | 방향 |
|------|------|------|
| **질문/허가 알림** | Claude Code 질문 발생 시 Slack으로 알림, 5분 미응답 시 리마인더 | Claude → Slack |
| **Slack 답변 → 작업 재개** | Slack에서 버튼/텍스트로 응답 → Claude Code가 수신하여 작업 계속 | Slack → Claude |
| **원격 작업 실행** | Slack에서 프롬프트 입력 → Claude Code CLI 실행 → 결과 Slack 반환 | Slack ⇄ Claude |

### 1.2 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        개발자 PC                             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Slack Bot 서비스 (상시 실행)                 │  │
│  │                                                        │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ 알림 모듈    │  │ 응답 수신    │  │ 원격 실행    │  │  │
│  │  │ (Notifier)  │  │ (Responder)  │  │ (Executor)   │  │  │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  │  │
│  │         │                │                  │          │  │
│  │         └────────────────┼──────────────────┘          │  │
│  │                          │                             │  │
│  │                   Slack Bolt SDK                        │  │
│  │                   (WebSocket 연결)                      │  │
│  └──────────────────────────┬─────────────────────────────┘  │
│                             │                                │
│  ┌──────────────────────────┴─────────────────────────────┐  │
│  │              MCP 서버 (Claude Code 세션 연동)             │  │
│  │                                                        │  │
│  │  도구: slack_ask(question, options)                     │  │
│  │  도구: slack_notify(message)                            │  │
│  │  도구: slack_wait_response(timeout)                     │  │
│  └──────────────────────────┬─────────────────────────────┘  │
│                             │                                │
│  ┌──────────────────────────┴─────────────────────────────┐  │
│  │              Claude Code CLI                             │  │
│  │  - 대화형 모드 (직접 사용)                                │  │
│  │  - 비대화형 모드 (Slack 원격 실행: claude -p)             │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              공유 상태 (Shared State)                     │  │
│  │  - pending-questions.json (대기 중인 질문)                │  │
│  │  - execution-queue.json (작업 큐)                        │  │
│  │  - config.json (설정)                                    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Slack API        │
                    │  (워크스페이스)    │
                    └──────────────────┘
```

---

## 2. 기능 상세 설계

### 2.1 기능 1: 질문/허가 알림 시스템

#### 트리거 조건
- Claude Code가 `AskUserQuestion` 도구를 호출할 때
- Claude Code Hooks의 `pre_tool_execution`으로 감지

#### 동작 흐름

```
[Claude Code] → AskUserQuestion 호출
      │
      ├─ [pre_hook] Slack Bot 서비스에 질문 등록
      │     │
      │     ├─ pending-questions.json에 질문 저장
      │     ├─ 5분 타이머 시작
      │     └─ (사용자가 CLI에서 바로 응답할 수도 있음)
      │
      ├─ [5분 경과, 미응답] Slack 알림 발송
      │     │
      │     └─ 메시지 포맷:
      │         ┌────────────────────────────────┐
      │         │ 🔔 Claude Code 질문 대기 중      │
      │         │                                │
      │         │ 프로젝트: gameServer             │
      │         │ 질문: "DB 스키마 변경 허가?"      │
      │         │                                │
      │         │ [승인] [거절] [답변 입력]         │
      │         │                                │
      │         │ ⏰ 대기 시간: 5분               │
      │         └────────────────────────────────┘
      │
      └─ [post_hook] 응답 수신 시 타이머 취소
```

#### Hooks 설정

```json
// .claude/settings.json
{
  "hooks": {
    "pre_tool_execution": [
      {
        "matcher": "AskUserQuestion",
        "command": "node C:/program1/gameServer/VIBE_CODING_1/slack-claude/scripts/on-question-asked.js"
      }
    ],
    "post_tool_execution": [
      {
        "matcher": "AskUserQuestion",
        "command": "node C:/program1/gameServer/VIBE_CODING_1/slack-claude/scripts/on-question-answered.js"
      }
    ]
  }
}
```

#### Hook 스크립트 설계

**on-question-asked.js**
```
입력: 환경변수 또는 stdin으로 질문 내용 수신
동작:
  1. pending-questions.json에 질문 추가 (ID, 내용, 타임스탬프)
  2. 5분 타이머 프로세스 시작 (PID 저장)
  3. 타이머 만료 시 → Slack Bot 서비스에 알림 요청
출력: 없음 (비동기)
```

**on-question-answered.js**
```
입력: 환경변수 또는 stdin으로 응답 내용 수신
동작:
  1. pending-questions.json에서 해당 질문 제거
  2. 타이머 프로세스 종료 (저장된 PID로)
출력: 없음
```

---

### 2.2 기능 2: Slack 답변 → Claude Code 작업 재개

#### 핵심 과제
- `AskUserQuestion`은 CLI 터미널 입력을 블로킹 대기
- 외부(Slack)에서 답변을 주입하려면 **커스텀 MCP 도구**가 필요

#### MCP 서버 설계

```
MCP 서버명: slack-claude-bridge
프로토콜: stdio (로컬 프로세스)

도구 목록:
  1. slack_ask
     - 설명: Slack으로 질문을 보내고 답변을 기다림
     - 파라미터:
       - question: string (질문 내용)
       - options: string[] (선택지, 선택사항)
       - timeout: number (대기 시간, 기본 30분)
     - 반환: { answer: string, respondedBy: string, timestamp: string }
     - 동작:
       1. Slack 채널에 인터랙티브 메시지 발송
       2. WebSocket으로 응답 대기
       3. 응답 수신 시 결과 반환

  2. slack_notify
     - 설명: Slack으로 단방향 알림 발송
     - 파라미터:
       - message: string (알림 내용)
       - level: "info" | "warning" | "error"
     - 반환: { sent: boolean, timestamp: string }

  3. slack_wait_response
     - 설명: 이전에 보낸 메시지에 대한 응답 대기
     - 파라미터:
       - messageId: string (대기할 메시지 ID)
       - timeout: number (대기 시간)
     - 반환: { response: string, timedOut: boolean }
```

#### MCP 서버 등록

```json
// .claude/settings.json
{
  "mcpServers": {
    "slack-claude-bridge": {
      "command": "node",
      "args": ["C:/program1/gameServer/VIBE_CODING_1/slack-claude/mcp-server/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_APP_TOKEN": "${SLACK_APP_TOKEN}",
        "SLACK_CHANNEL_ID": "${SLACK_CHANNEL_ID}",
        "ALLOWED_USER_IDS": "${ALLOWED_USER_IDS}"
      }
    }
  }
}
```

#### MEMORY.md 추가 규칙
```markdown
## Slack 연동 규칙
- 질문/허가가 필요할 때 slack_ask 도구를 우선 사용
- CLI 직접 사용 중일 때는 AskUserQuestion 유지
- Slack 연동 모드는 환경변수 SLACK_MODE=true 일 때만 활성화
```

#### Slack 인터랙티브 메시지 포맷

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🤖 Claude Code 질문" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*프로젝트*: gameServer\n*질문*: DB 스키마를 변경해도 될까요?"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "✅ 승인" },
          "style": "primary",
          "action_id": "approve",
          "value": "approved"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "❌ 거절" },
          "style": "danger",
          "action_id": "reject",
          "value": "rejected"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "💬 답변 입력" },
          "action_id": "custom_reply"
        }
      ]
    }
  ]
}
```

---

### 2.3 기능 3: Slack에서 원격 작업 실행

#### 동작 흐름

```
[Slack]  사용자: /claude user 테이블에 email 컬럼 추가해줘
            │
            ▼
[Slack Bot 서비스]
    │
    ├─ 1. 권한 확인 (허용된 유저인지)
    ├─ 2. 명령어 파싱 및 검증
    ├─ 3. Slack에 "작업 시작" 메시지 전송
    ├─ 4. Claude Code CLI 실행
    │     │
    │     │  child_process.spawn('claude', [
    │     │    '-p', 'user 테이블에 email 컬럼 추가해줘',
    │     │    '--cwd', 'C:\\program1\\gameServer\\VIBE_CODING_1',
    │     │    '--output-format', 'json',
    │     │    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash'
    │     │  ])
    │     │
    │     ├─ stdout 스트리밍 → Slack 실시간 업데이트
    │     └─ 작업 완료 → 최종 결과 반환
    │
    ├─ 5. 결과를 Slack 메시지로 전송
    └─ 6. execution-queue에서 작업 제거
```

#### Slack 명령어 체계

```
/claude <프롬프트>          → 작업 실행
/claude-status              → 현재 진행 중인 작업 상태
/claude-cancel              → 진행 중인 작업 취소
/claude-queue               → 대기 중인 작업 목록
/claude-config              → 설정 확인/변경
```

#### 실행 결과 Slack 메시지 포맷

```
┌─────────────────────────────────────────┐
│ 🤖 Claude Code 작업 완료                  │
│                                         │
│ 📋 요청: user 테이블에 email 컬럼 추가     │
│ ⏱️ 소요: 45초                             │
│                                         │
│ 📝 변경 파일:                              │
│   ✏️ src/models/user.js (수정)            │
│   ➕ migrations/20260206_add_email.js    │
│                                         │
│ 🔍 코드 리뷰: 이상 없음 ✅                 │
│                                         │
│ 🔀 Git:                                  │
│   브랜치: feature/add-email-column       │
│   PR: #12                               │
│                                         │
│ ⚠️ 서버 재시작 필요: npm run dev           │
│                                         │
│ [상세 로그 보기] [PR 열기] [되돌리기]       │
└─────────────────────────────────────────┘
```

#### 작업 큐 시스템

```javascript
// execution-queue.json 스키마
{
  "queue": [
    {
      "id": "uuid",
      "prompt": "user 테이블에 email 컬럼 추가해줘",
      "requestedBy": "U0123SLACK",
      "requestedAt": "2026-02-06T10:30:00Z",
      "status": "running" | "queued" | "completed" | "failed" | "cancelled",
      "pid": 12345,
      "result": null | { ... },
      "completedAt": null | "2026-02-06T10:31:00Z"
    }
  ],
  "config": {
    "maxConcurrent": 1,
    "maxQueueSize": 5,
    "defaultTimeout": 600000
  }
}
```

---

## 3. 기술 스택

| 구성 요소 | 기술 | 버전 | 용도 |
|-----------|------|------|------|
| 런타임 | Node.js | 18+ | 전체 서비스 실행 |
| Slack SDK | @slack/bolt | 최신 | Slack WebSocket + 인터랙티브 |
| MCP SDK | @modelcontextprotocol/sdk | 최신 | MCP 서버 구현 |
| 프로세스 관리 | child_process (내장) | - | Claude CLI 실행 |
| 상태 관리 | JSON 파일 | - | 큐, 설정, 대기 질문 |
| 프로세스 매니저 | pm2 또는 Windows Service | - | 상시 실행 보장 |

---

## 4. 디렉토리 구조

```
slack-claude/
├── package.json
├── .env                          # 환경변수 (Slack 토큰 등)
├── .env.example                  # 환경변수 템플릿
│
├── bot-service/                  # Slack Bot 서비스 (상시 실행)
│   ├── index.js                  # 진입점, Bolt 앱 초기화
│   ├── handlers/
│   │   ├── command-handler.js    # /claude 명령어 처리
│   │   ├── action-handler.js     # 버튼 클릭 (승인/거절) 처리
│   │   └── message-handler.js    # DM 메시지 처리
│   ├── services/
│   │   ├── executor.js           # Claude CLI 실행 관리
│   │   ├── queue.js              # 작업 큐 관리
│   │   └── notifier.js           # 알림 발송
│   └── utils/
│       ├── slack-formatter.js    # Slack Block Kit 메시지 빌더
│       ├── security.js           # 권한 검증
│       └── logger.js             # 로깅
│
├── mcp-server/                   # MCP 서버 (Claude Code 세션 연동)
│   ├── index.js                  # MCP 서버 진입점
│   ├── tools/
│   │   ├── slack-ask.js          # slack_ask 도구 구현
│   │   ├── slack-notify.js       # slack_notify 도구 구현
│   │   └── slack-wait.js         # slack_wait_response 도구 구현
│   └── bridge/
│       └── state-manager.js      # 공유 상태 관리 (JSON 파일 I/O)
│
├── scripts/                      # Claude Code Hooks 스크립트
│   ├── on-question-asked.js      # pre_hook: 질문 감지
│   └── on-question-answered.js   # post_hook: 응답 감지
│
├── state/                        # 런타임 상태 파일
│   ├── pending-questions.json    # 대기 중인 질문
│   ├── execution-queue.json      # 작업 큐
│   └── timer-pids.json           # 타이머 프로세스 PID
│
└── config/
    ├── default.json              # 기본 설정
    └── security.json             # 허용 유저, 금지 명령어
```

---

## 5. 보안 설계

### 5.1 인증/인가

```json
// config/security.json
{
  "allowedSlackUsers": ["U0123ABC"],
  "allowedChannels": ["C0456DEF"],
  "blockedCommands": [
    "rm -rf",
    "format",
    "del /f",
    "DROP TABLE",
    "DROP DATABASE"
  ],
  "maxPromptLength": 2000,
  "requireConfirmationFor": [
    "git push",
    "git reset",
    "database migration",
    "delete",
    "remove"
  ]
}
```

### 5.2 환경변수 관리

```bash
# .env (절대 커밋하지 않음)
SLACK_BOT_TOKEN=xoxb-...          # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...          # App-Level Token (Socket Mode)
SLACK_CHANNEL_ID=C0123...         # 알림 채널
SLACK_SIGNING_SECRET=...          # 요청 검증
ALLOWED_USER_IDS=U0123,U0456      # 허용 유저
CLAUDE_WORKING_DIR=C:\program1\gameServer\VIBE_CODING_1
```

### 5.3 위험 명령어 처리

```
사용자가 위험 명령어 입력 시:
  1. 명령어를 blockedCommands와 대조
  2. requireConfirmationFor에 해당하면 추가 확인 요청
  3. 차단된 명령어는 실행 거부 + 사유 안내
```

---

## 6. Slack App 생성 가이드

### 6.1 필요한 Slack App 설정

```yaml
# Slack App Manifest
display_information:
  name: Claude Code Bot
  description: Claude Code 연동 봇

features:
  bot_user:
    display_name: claude-code
    always_online: true
  slash_commands:
    - command: /claude
      description: Claude Code에 작업 요청
    - command: /claude-status
      description: 작업 상태 확인
    - command: /claude-cancel
      description: 작업 취소

oauth_config:
  scopes:
    bot:
      - chat:write           # 메시지 발송
      - commands              # 슬래시 명령어
      - im:history            # DM 읽기
      - im:write              # DM 발송
      - channels:history      # 채널 메시지 읽기

settings:
  socket_mode_enabled: true   # WebSocket 사용
  interactivity:
    is_enabled: true          # 버튼 인터랙션
```

### 6.2 토큰 발급 절차

```
1. https://api.slack.com/apps 접속
2. "Create New App" → "From manifest" 선택
3. 위 Manifest YAML 붙여넣기
4. App 생성 후:
   - "OAuth & Permissions" → Bot User OAuth Token 복사 → SLACK_BOT_TOKEN
   - "Basic Information" → App-Level Token 생성 (connections:write) → SLACK_APP_TOKEN
   - "Basic Information" → Signing Secret 복사 → SLACK_SIGNING_SECRET
5. 워크스페이스에 앱 설치
6. 사용할 채널에 봇 초대: /invite @claude-code
```

---

## 7. 구현 순서 (우선순위)

### Phase 1: 기반 구축
```
1. slack-claude/ 프로젝트 초기화 (npm init)
2. 의존성 설치 (@slack/bolt, @modelcontextprotocol/sdk)
3. Slack App 생성 및 토큰 발급
4. .env 설정
5. 기본 Slack Bot 연결 테스트
```

### Phase 2: 알림 시스템 (기능 1)
```
1. bot-service/services/notifier.js 구현
2. scripts/on-question-asked.js 구현
3. scripts/on-question-answered.js 구현
4. Claude Code Hooks 설정
5. 5분 타이머 + Slack 알림 테스트
```

### Phase 3: Slack 답변 연동 (기능 2)
```
1. mcp-server/index.js 구현 (MCP 서버 기본 구조)
2. mcp-server/tools/slack-ask.js 구현
3. mcp-server/tools/slack-notify.js 구현
4. bot-service/handlers/action-handler.js 구현 (버튼 응답)
5. MCP 서버 등록 및 연동 테스트
6. MEMORY.md에 slack_ask 우선 사용 규칙 추가
```

### Phase 4: 원격 실행 (기능 3)
```
1. bot-service/handlers/command-handler.js 구현
2. bot-service/services/executor.js 구현 (Claude CLI 래퍼)
3. bot-service/services/queue.js 구현 (작업 큐)
4. config/security.json 설정
5. 슬래시 명령어 테스트
6. 실행 결과 Slack 포맷팅
```

### Phase 5: 안정화
```
1. 에러 핸들링 강화
2. pm2 또는 Windows Service로 상시 실행 설정
3. 로깅 시스템 구축
4. 보안 검증 (권한, 금지 명령어)
5. 통합 테스트
```

---

## 8. 핵심 코드 스니펫 (구현 참고용)

### 8.1 Slack Bot 서비스 진입점

```javascript
// bot-service/index.js
const { App } = require('@slack/bolt');
const { setupCommandHandlers } = require('./handlers/command-handler');
const { setupActionHandlers } = require('./handlers/action-handler');
const { setupMessageHandlers } = require('./handlers/message-handler');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

setupCommandHandlers(app);   // /claude, /claude-status 등
setupActionHandlers(app);    // 버튼 클릭 처리
setupMessageHandlers(app);   // DM 메시지 처리

(async () => {
  await app.start();
  console.log('Slack Bot 서비스 시작됨');
})();
```

### 8.2 MCP 서버 진입점

```javascript
// mcp-server/index.js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { slackAskTool } = require('./tools/slack-ask');
const { slackNotifyTool } = require('./tools/slack-notify');
const { slackWaitTool } = require('./tools/slack-wait');

const server = new Server(
  { name: 'slack-claude-bridge', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// 도구 등록
server.setRequestHandler('tools/list', async () => ({
  tools: [slackAskTool.definition, slackNotifyTool.definition, slackWaitTool.definition]
}));

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case 'slack_ask': return slackAskTool.handler(args);
    case 'slack_notify': return slackNotifyTool.handler(args);
    case 'slack_wait_response': return slackWaitTool.handler(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
server.connect(transport);
```

### 8.3 Claude CLI 실행기

```javascript
// bot-service/services/executor.js
const { spawn } = require('child_process');

function executeClaude(prompt, options = {}) {
  const {
    cwd = process.env.CLAUDE_WORKING_DIR,
    timeout = 600000,
    onProgress = () => {},
  } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '-p', prompt,
      '--cwd', cwd,
      '--output-format', 'json',
    ], { shell: true });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      onProgress(data.toString());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('실행 시간 초과'));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, output: stdout, pid: proc.pid });
      } else {
        reject(new Error(`종료 코드 ${code}: ${stderr}`));
      }
    });
  });
}

module.exports = { executeClaude };
```

### 8.4 Hook 스크립트 - 질문 감지

```javascript
// scripts/on-question-asked.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATE_DIR = path.join(__dirname, '..', 'state');
const PENDING_FILE = path.join(STATE_DIR, 'pending-questions.json');
const TIMER_FILE = path.join(STATE_DIR, 'timer-pids.json');

// stdin에서 hook 데이터 읽기
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const hookData = JSON.parse(input);
  const questionId = Date.now().toString();

  // 대기 질문 등록
  const pending = readJson(PENDING_FILE);
  pending[questionId] = {
    question: hookData.tool_input,
    timestamp: new Date().toISOString(),
    answered: false,
  };
  writeJson(PENDING_FILE, pending);

  // 5분 타이머 시작
  const timer = spawn('node', [
    path.join(__dirname, 'notification-timer.js'),
    questionId,
    '300000', // 5분
  ], { detached: true, stdio: 'ignore' });
  timer.unref();

  // PID 저장
  const timers = readJson(TIMER_FILE);
  timers[questionId] = timer.pid;
  writeJson(TIMER_FILE, timers);
});

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
```

---

## 9. 설정 파일 요약

### Claude Code에 필요한 설정

```json
// .claude/settings.json 에 추가할 내용
{
  "hooks": {
    "pre_tool_execution": [
      {
        "matcher": "AskUserQuestion",
        "command": "node slack-claude/scripts/on-question-asked.js"
      }
    ],
    "post_tool_execution": [
      {
        "matcher": "AskUserQuestion",
        "command": "node slack-claude/scripts/on-question-answered.js"
      }
    ]
  },
  "mcpServers": {
    "slack-claude-bridge": {
      "command": "node",
      "args": ["slack-claude/mcp-server/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_APP_TOKEN": "${SLACK_APP_TOKEN}",
        "SLACK_CHANNEL_ID": "${SLACK_CHANNEL_ID}"
      }
    }
  }
}
```

### MEMORY.md에 추가할 규칙

```markdown
## Slack 연동 규칙
- SLACK_MODE=true 환경변수가 설정되어 있으면:
  - AskUserQuestion 대신 slack_ask MCP 도구 우선 사용
  - 작업 완료 시 slack_notify로 결과 알림
- SLACK_MODE가 없으면 기존 방식(CLI) 유지
```

---

## 10. 의존성 목록

```json
// slack-claude/package.json
{
  "name": "slack-claude-integration",
  "version": "1.0.0",
  "description": "Slack-Claude Code 통합 시스템",
  "dependencies": {
    "@slack/bolt": "^3.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "nodemon": "^3.x"
  },
  "scripts": {
    "start": "node bot-service/index.js",
    "dev": "nodemon bot-service/index.js",
    "mcp": "node mcp-server/index.js"
  }
}
```

---

## 11. 테스트 체크리스트

### Phase 2 테스트
- [ ] Slack Bot이 워크스페이스에 정상 연결되는가
- [ ] AskUserQuestion 호출 시 pre_hook이 실행되는가
- [ ] 5분 후 Slack 알림이 발송되는가
- [ ] CLI에서 응답 시 타이머가 취소되는가

### Phase 3 테스트
- [ ] MCP 서버가 Claude Code에 정상 등록되는가
- [ ] slack_ask 호출 시 Slack에 인터랙티브 메시지가 표시되는가
- [ ] 승인/거절 버튼 클릭 시 Claude Code가 응답을 수신하는가
- [ ] 텍스트 답변 입력 시 정상 전달되는가

### Phase 4 테스트
- [ ] /claude 명령어로 작업이 실행되는가
- [ ] 진행 중 상태가 Slack에 업데이트되는가
- [ ] 작업 완료 결과가 포맷팅되어 표시되는가
- [ ] 동시 요청 시 큐가 정상 동작하는가
- [ ] 허용되지 않은 유저의 요청이 차단되는가
- [ ] 금지 명령어가 필터링되는가

---

## 12. 제약사항 및 알려진 한계

| 항목 | 내용 |
|------|------|
| Claude API 비용 | Slack 원격 실행 시 매 요청마다 API 호출 발생 |
| 동시성 | 기본 maxConcurrent=1, 순차 실행 권장 |
| 타임아웃 | 대규모 작업은 10분 타임아웃 초과 가능 |
| Windows 의존 | child_process 경로 처리가 OS에 종속적 |
| Slack 무료 플랜 | 메시지 기록 제한 있음 (90일) |
| 보안 | Bot Token 유출 시 원격 코드 실행 위험 → 토큰 관리 철저 |
