# mcp-slack-bridge

Slack-Claude Code 멀티세션 통합 시스템.

여러 터미널(VS Code, Warp, Windows Terminal 등)에서 동시 실행되는 Claude Code 세션을 하나의 Slack 채널로 통합 관리합니다.

**주요 기능:**
- **질문 알림** - Claude Code가 사용자 판단이 필요한 질문을 Slack으로 전송
- **Slack 응답** - Slack 버튼 또는 텍스트로 Claude Code에 직접 응답
- **알림 전송** - 작업 완료, 에러 등 단방향 알림을 Slack으로 전송
- **세션 관리** - 멀티세션 환경에서 각 세션을 독립적으로 추적/관리
- **세션 리모트 커맨드** - Slack 쓰레드에서 기존 Claude Code 세션에 직접 명령 전달

## 아키텍처

```
다양한 실행 환경
├─ VS Code Terminal    → 세션 A → MCP Server A → state/sessions/uuid-aaa/
├─ Warp Terminal       → 세션 B → MCP Server B → state/sessions/uuid-bbb/
├─ Windows Terminal    → 세션 C → MCP Server C → state/sessions/uuid-ccc/
└─ PowerShell          → 세션 D → MCP Server D → state/sessions/uuid-ddd/
                                    ↕
                    Bot Service (싱글톤, 상시 실행)
                    - 2초마다 state/sessions/ 폴링
                    - 새 질문 발견 → Slack 메시지 발송
                    - 버튼 응답 → 해당 세션에 response 기록
                    - 새 세션 감지 → Slack 쓰레드 자동 생성
                    - 명령 결과 감지 → 쓰레드에 결과 게시
                                    ↕
                              Slack API (Socket Mode)
```

**3개 모듈 구성:**

| 모듈 | 역할 | 실행 방식 |
|------|------|----------|
| `bot-service` | Slack Bot (Socket Mode) | 상시 실행 싱글톤 |
| `mcp-server` | MCP 도구 제공 (stdio) | 세션당 1개 인스턴스 |
| `shared` | 공유 타입/유틸리티 | 라이브러리 |

**통신 방식:** 파일 기반 IPC (`state/sessions/{uuid}/`)로 프로세스 간 직접 연결 불필요.

## 기술 스택

| 카테고리 | 기술 | 버전 |
|---------|------|------|
| Framework | NestJS (Monorepo) | v11 |
| Slack SDK | @slack/bolt (Socket Mode) | v4.6.0 |
| MCP SDK | @modelcontextprotocol/sdk (stdio) | v1.26.0 |
| Language | TypeScript | v5.9 |
| Runtime | Node.js | v20+ |
| Testing | Jest | v30 |

## 사전 요구사항

- **Node.js** v20 이상
- **npm** (Node.js와 함께 설치됨)
- **Slack Workspace** (앱 생성 권한 필요)
- **Claude Code CLI** 설치 완료

## Slack App 설정 가이드

### 1. 앱 생성

1. [api.slack.com/apps](https://api.slack.com/apps) 접속
2. **Create New App** → **From scratch** 선택
3. App Name 입력 (예: `Claude Code Bridge`), Workspace 선택

### 2. Socket Mode 활성화

1. 좌측 메뉴 **Settings → Socket Mode** → **Enable Socket Mode**
2. App-Level Token 생성: Token Name 입력 → `connections:write` scope 추가 → **Generate**
3. 생성된 `xapp-` 토큰 복사 → `.env`의 `SLACK_APP_TOKEN`에 입력

### 3. Bot Token Scopes 설정

1. 좌측 메뉴 **Features → OAuth & Permissions**
2. **Scopes → Bot Token Scopes**에서 추가:
   - `chat:write` - 메시지 전송
   - `channels:read` - 채널 정보 조회
3. **Install to Workspace** 클릭 → 권한 승인
4. 생성된 `xoxb-` 토큰 복사 → `.env`의 `SLACK_BOT_TOKEN`에 입력

### 4. Signing Secret 확인

1. 좌측 메뉴 **Settings → Basic Information**
2. **App Credentials → Signing Secret** 복사 → `.env`의 `SLACK_SIGNING_SECRET`에 입력

### 5. Interactivity 활성화

1. 좌측 메뉴 **Features → Interactivity & Shortcuts**
2. **Interactivity** 토글 ON (Socket Mode이므로 Request URL 불필요)

### 6. Slash Commands 등록

1. 좌측 메뉴 **Features → Slash Commands**
2. **Create New Command** 클릭 후 아래 명령어들을 등록:

| Command | Short Description |
|---------|-------------------|
| `/claude` | Claude Code에 프롬프트 전송 |
| `/claude-sessions` | 활성 세션 목록 조회 |
| `/claude-inject` | 세션에 컨텍스트 주입 |
| `/claude-status` | 실행 큐 상태 조회 |
| `/claude-cancel` | 실행 중인 작업 취소 |

> Socket Mode를 사용하므로 **Request URL**은 아무 값(예: `https://localhost`)을 넣으면 됩니다.

### 7. Event Subscriptions 설정 (Thread Control)

쓰레드에서 `@claude stop`, `@claude status` 등의 멘션 명령을 사용하려면 Event Subscription 설정이 필요합니다.

1. 좌측 메뉴 **Features → Event Subscriptions**
2. **Enable Events** 토글 ON
3. **Subscribe to bot events** 섹션에서 **Add Bot User Event** 클릭
4. `app_mention` 이벤트 추가
5. 페이지 하단 **Save Changes** 클릭

> `app_mention` 이벤트를 추가하면 **OAuth & Permissions**에 `app_mentions:read` scope가 자동 추가됩니다. 변경 후 앱을 Workspace에 **재설치**(Reinstall)해야 적용됩니다.

**앱 재설치 방법:**
1. 좌측 메뉴 **Settings → Install App**
2. **Reinstall to Workspace** 클릭 → 권한 승인

### 8. 채널에 Bot 초대

```
/invite @Claude Code Bridge
```

채널 ID 확인: Slack에서 채널 우클릭 → **Channel details** → 하단의 ID 복사

## 설치 및 환경 설정

```bash
# 의존성 설치
npm install
```

### Setup Wizard (자동 설정)

`.env` 파일이 없는 상태에서 Bot 서비스를 시작하면 **Setup Wizard**가 자동으로 실행됩니다.

```bash
npm run start:bot
# → .env 파일이 없으면 브라우저에서 Setup Wizard가 열림 (http://localhost:3456)
# → .env 파일이 있으면 Wizard를 건너뛰고 바로 서비스 시작
```

Wizard에서 Slack 토큰, 채널 ID, 사용자 ID 등을 입력하면 `.env` 파일이 자동 생성됩니다.

> **참고**: `.env` 파일이 이미 존재하면 Wizard는 실행되지 않습니다. 설정을 다시 변경하려면 `.env` 파일을 삭제하거나 직접 편집하세요. `SKIP_WIZARD=true` 또는 `NODE_ENV=production` 환경에서도 Wizard가 건너뛰어집니다.

### 수동 설정

Wizard를 사용하지 않으려면 수동으로 `.env` 파일을 생성합니다:

```bash
cp .env.example .env
```

`.env` 파일을 열고 아래 **필수 환경변수**를 설정합니다:

### 필수 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token | `xoxb-...` |
| `SLACK_APP_TOKEN` | App-Level Token (Socket Mode) | `xapp-...` |
| `SLACK_SIGNING_SECRET` | 앱 Signing Secret | `abc123...` |
| `SLACK_CHANNEL_ID` | 알림을 보낼 Slack 채널 ID | `C0123456789` |
| `ALLOWED_USER_IDS` | 허용된 Slack 사용자 ID (쉼표 구분) | `U0123ABC` |

### 선택 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `ALLOWED_CHANNEL_IDS` | 허용 채널 ID (쉼표 구분, 빈값=전체) | - |
| `CLAUDE_WORKING_DIR` | Claude Code 기본 작업 디렉토리 | - |
| `STATE_DIR` | 상태 파일 저장 경로 | `./state` |
| `BLOCKED_COMMANDS` | 차단할 명령어 (쉼표 구분) | `rm -rf,format,del /f,...` |
| `CONFIRM_COMMANDS` | 확인 필요 명령어 (쉼표 구분) | `git push,git reset,...` |
| `MAX_PROMPT_LENGTH` | 최대 프롬프트 길이 | `2000` |
| `NOTIFICATION_DELAY_SECONDS` | 질문 Slack 전송 지연 (초, 0=즉시) | `300` (5분) |
| `MAX_ACTIVE_SESSIONS` | 최대 동시 세션 수 | `10` |
| `SESSION_TIMEOUT_MS` | 세션 타임아웃 (ms) | `3600000` (1시간) |
| `HEARTBEAT_INTERVAL_MS` | Heartbeat 간격 (ms) | `30000` (30초) |
| `STALE_SESSION_MS` | Stale 세션 정리 임계값 (ms) | `300000` (5분) |
| `POLL_INTERVAL_MS` | 세션 디렉토리 스캔 간격 (ms) | `2000` (2초) |
| `MAX_CONCURRENT_EXECUTIONS` | 최대 동시 실행 수 | `1` |
| `MAX_QUEUE_SIZE` | 실행 큐 최대 크기 | `5` |
| `EXECUTION_TIMEOUT_MS` | 실행 타임아웃 (ms) | `600000` (10분) |
| `LOG_LEVEL` | 로그 레벨 (debug/info/warn/error) | `info` |

## 빌드 및 실행

```bash
# 전체 빌드
npm run build:all

# Bot 서비스 실행 (Socket Mode)
npm run start:bot

# Bot 서비스 개발 모드 (watch)
npm run start:bot:dev
```

개별 모듈 빌드:
```bash
npm run build:shared    # 공유 라이브러리
npm run build:bot       # Bot 서비스
npm run build:mcp       # MCP 서버
```

## Claude Code MCP 서버 설정

Claude Code에서 MCP 서버를 사용하려면 설정 파일에 등록해야 합니다.

**글로벌 설정** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "slack-bridge": {
      "command": "node",
      "args": ["C:/program1/gameServer/mcp-slack-bridge/dist/apps/mcp-server/main.js"],
      "env": {
        "STATE_DIR": "C:/program1/gameServer/mcp-slack-bridge/state"
      }
    }
  }
}
```

**프로젝트별 설정** (`.claude/settings.local.json`):
```json
{
  "mcpServers": {
    "slack-bridge": {
      "command": "node",
      "args": ["/path/to/mcp-slack-bridge/dist/apps/mcp-server/main.js"],
      "env": {
        "STATE_DIR": "/path/to/mcp-slack-bridge/state"
      }
    }
  }
}
```

> MCP 서버는 stdio transport를 사용하며, Claude Code가 세션 시작 시 자동으로 프로세스를 생성합니다.

### 멀티세션 환경 참고사항

여러 터미널에서 동시에 Claude Code를 실행하는 경우:
- `.env`의 `CLAUDE_WORKING_DIR`는 **설정하지 마세요** (주석 유지)
- 각 MCP 서버가 Claude Code 실행 디렉토리를 자동 감지합니다 (`process.cwd()`)
- `STATE_DIR`만 모든 세션이 공유하는 동일 경로로 설정하면 됩니다

## MCP 도구

### `slack_ask` - 질문 전송 및 응답 대기

Slack으로 질문을 보내고 사용자 응답을 기다립니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `question` | string | O | 질문 내용 |
| `options` | string[] | X | 선택지 (버튼으로 표시) |
| `timeout` | number | X | 응답 대기 시간 (ms, 기본 30분) |

```
질문 파일 생성 → Bot이 폴링으로 감지 → Slack 메시지 발송 → 사용자 응답 → 응답 파일 기록 → MCP가 응답 반환
```

### `slack_notify` - 단방향 알림

Slack으로 알림을 보냅니다. 응답을 기다리지 않습니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `message` | string | O | 알림 내용 |
| `level` | `"info"` \| `"warning"` \| `"error"` | X | 알림 레벨 (기본 info) |

### `slack_wait_response` - 이전 질문 응답 대기

이전에 `slack_ask`로 보낸 질문에 대한 응답을 대기합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `questionId` | string | O | 응답을 기다릴 질문 ID |
| `timeout` | number | X | 응답 대기 시간 (ms, 기본 30분) |

### `slack_check_commands` - Slack 명령 수신

Slack 세션 쓰레드에서 전달된 명령을 확인합니다. 블로킹 모드에서는 새 명령이 올 때까지 대기합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `blocking` | boolean | X | 블로킹 모드 (기본 true, false이면 즉시 반환) |
| `timeout` | number | X | 블로킹 타임아웃 (ms, 기본 5분) |

```
Slack 쓰레드 멘션 → Bot → commands/ 파일 생성 → MCP 폴링으로 명령 수신 → Claude Code 실행
```

### `slack_command_result` - 명령 실행 결과 보고

실행한 명령의 결과를 Slack 세션 쓰레드에 보고합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `commandId` | string | O | 실행한 명령 ID |
| `result` | string | O | 실행 결과 텍스트 |
| `status` | `"success"` \| `"error"` | X | 결과 상태 (기본 success) |

```
Claude Code 실행 완료 → command-results/ 파일 생성 → Bot 폴링으로 감지 → Slack 쓰레드에 결과 게시
```

## Slack 명령어

### `/claude` - Claude Code 원격 실행

```
/claude [모드] <프롬프트>
```

| 모드 | 설명 | 예시 |
|------|------|------|
| (없음) | 기본 실행 | `/claude user 테이블에 email 컬럼 추가해줘` |
| `plan` | 계획 모드 | `/claude plan 아키텍처를 설계해줘` |
| `brainstorm` | 브레인스톰 모드 | `/claude brainstorm 새 기능 아이디어` |
| `analyze` | 분석 모드 | `/claude analyze 코드 분석해줘` |
| `review` | 리뷰 모드 | `/claude review PR 검토해줘` |

### Thread Control (쓰레드 명령)

`/claude` 명령으로 작업이 시작되면, 해당 메시지의 **쓰레드 안에서** `@claude` 멘션으로 작업을 제어할 수 있습니다.

| 명령 | 설명 |
|------|------|
| `@claude stop` | 실행 중인 작업을 중지하고 대기 상태로 전환 |
| `@claude status` | 현재 작업의 상태를 조회 |
| `@claude <새 프롬프트>` | 같은 쓰레드에서 새 작업을 시작 |

> **주의**: Thread Control은 쓰레드 내부에서만 작동합니다. 쓰레드 밖의 멘션은 무시됩니다.

### 세션 리모트 커맨드 (Session Remote Command)

Bot이 활성 Claude Code 세션을 자동 감지하여 Slack에 세션 쓰레드를 생성합니다. 해당 쓰레드에서 `@claude` 멘션으로 **기존 세션에 직접 명령을 전달**할 수 있습니다.

| 명령 | 설명 |
|------|------|
| `@claude status` | 세션 상태 조회 (환경, 가동 시간 등) |
| `@claude <명령>` | 해당 세션에 명령 전달 (Claude Code가 실행) |

**데이터 흐름:**
```
[Bot 시작 / 2초 폴링]
  → state/sessions/ 스캔 → 새 세션 발견 → Slack에 세션 쓰레드 게시

[세션 쓰레드에서 @claude 프로젝트 분석해줘]
  → Bot → commands/cmd-{ts}.json 생성 → "명령이 전달되었습니다" 확인

[Claude Code: slack_check_commands 호출]
  → 보류 명령 수신 → 실행 → slack_command_result 호출

[Bot 폴링]
  → command-results/ 감지 → 세션 쓰레드에 결과 게시

[세션 종료]
  → 쓰레드에 "세션이 종료되었습니다" 메시지
```

### 기타 명령어

| 명령 | 설명 |
|------|------|
| `/claude-sessions` | 활성 세션 목록 조회 |
| `/claude-inject <세션ID> <메시지>` | 특정 세션에 컨텍스트 주입 |
| `/claude-status` | 실행 큐 상태 (실행 중/대기 중) |
| `/claude-cancel [작업ID]` | 실행 중인 작업 취소 |

### 실행 방식 비교: `/claude` vs Session Remote Command

| 항목 | `/claude` Slash Command | Session Remote Command |
|------|------------------------|----------------------|
| 실행 방식 | 새 Claude 프로세스 생성 (`claude -p`) | 기존 실행 중인 세션에 명령 전달 |
| 실시간 모니터링 | **불가** — 백그라운드 실행, 완료 후 결과만 반환 | **가능** — PC 터미널에서 실시간 확인 |
| 작업 컨텍스트 | 매번 새로운 컨텍스트 | 기존 세션의 컨텍스트 유지 |
| 결과 확인 | Slack 쓰레드에 완료 메시지 | Slack 쓰레드 + PC 터미널 동시 확인 |
| 적합한 상황 | 독립적인 단발성 작업 | 진행 중인 작업에 추가 지시 |
| 세션 필요 여부 | 불필요 (Bot이 자동 생성) | Claude Code 세션 활성 상태 필요 |
| 중단 제어 | `/claude-cancel` 또는 `@claude stop` | 세션 자체에서 Ctrl+C |

> **언제 무엇을 사용하나요?**
> - 간단한 코드 생성, 분석, 리뷰 등 **독립적 단발 작업** → `/claude`
> - 현재 작업 중인 세션에 **추가 지시**가 필요하거나 **실시간 모니터링**이 필요한 경우 → Session Remote Command
>
> 자세한 비교는 [Slack 명령어 실행 방식 비교 가이드](./claudedocs/slack-command-guide.md)를 참고하세요.

## 프로젝트 구조

```
mcp-slack-bridge/
├── apps/
│   ├── bot-service/              # Slack Bot 서비스
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── slack/            # Slack 연동 모듈
│   │       ├── poller/           # 세션 디렉토리 폴링 + 세션 쓰레드 관리
│   │       ├── executor/         # 원격 실행 + 쓰레드 제어
│   │       └── wizard/           # Setup Wizard (웹 기반 설정)
│   │
│   └── mcp-server/               # MCP 서버 (stdio)
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── session/          # 세션 관리
│           ├── mcp/              # MCP 도구 (ask, notify, wait, check_commands, command_result)
│           └── bridge/           # 파일 기반 IPC
│
├── libs/
│   └── shared/                   # 공유 라이브러리
│       └── src/
│           ├── config/           # 환경변수 설정
│           ├── types/            # 공유 타입 정의
│           ├── utils/            # 유틸리티 (atomic write 등)
│           └── constants/        # 상수 정의
│
├── state/                        # 런타임 상태 (gitignore)
│   └── sessions/{uuid}/
│       ├── meta.json             # 세션 메타데이터
│       ├── heartbeat             # Heartbeat (mtime 기반)
│       ├── questions/            # 대기 중인 질문
│       ├── responses/            # Bot이 기록한 응답
│       ├── notifications/        # 알림 메시지
│       ├── commands/             # Slack에서 전달된 명령
│       └── command-results/      # 명령 실행 결과
│
├── claudedocs/                   # 설계 문서
├── .env.example                  # 환경변수 템플릿
├── nest-cli.json                 # NestJS Monorepo 설정
├── package.json
└── tsconfig.json
```

## 테스트

```bash
# 전체 테스트 실행
npm test

# Watch 모드
npm run test:watch

# 커버리지 리포트
npm run test:cov
```

## 개발 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 0 | 프로젝트 기반 구축 (NestJS Monorepo, 의존성, 공유 모듈) | ✅ 완료 |
| Phase 1 | 세션 관리 코어 (세션 생성, 환경 감지, heartbeat) | ✅ 완료 |
| Phase 2 | MCP 서버 (stdio 기반, 3개 도구 구현) | ✅ 완료 |
| Phase 3 | Bot 서비스 (폴링 기반 Slack 연동) | ✅ 완료 |
| Phase 4 | Hook 스크립트 (Claude Code 이벤트 연동) | ✅ 완료 |
| Phase 5 | Slack 명령어 확장 (원격 실행, 세션 관리) | ✅ 완료 |
| Thread Control | 쓰레드 기반 실시간 작업 제어 (@mention) | ✅ 완료 |
| Setup Wizard | 웹 기반 초기 설정 가이드 | ✅ 완료 |
| Session Remote Command | Slack → 기존 Claude Code 세션 명령 전달 | ✅ 완료 |
| Phase 6 | 안정화 및 배포 (모니터링, 문서화, CI/CD) | 미구현 |

## 라이선스

UNLICENSED - Private project
