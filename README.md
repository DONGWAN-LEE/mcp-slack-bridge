# mcp-slack-bridge

Slack-Claude Code 멀티세션 통합 시스템.

여러 터미널(VS Code, Warp, Windows Terminal 등)에서 동시 실행되는 Claude Code 세션을 하나의 Slack 채널로 통합 관리합니다.

**주요 기능:**
- **질문 알림** - Claude Code가 사용자 판단이 필요한 질문을 Slack으로 전송
- **Slack 응답** - Slack 버튼 또는 텍스트로 Claude Code에 직접 응답
- **알림 전송** - 작업 완료, 에러 등 단방향 알림을 Slack으로 전송
- **세션 관리** - 멀티세션 환경에서 각 세션을 독립적으로 추적/관리

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

### 6. 채널에 Bot 초대

```
/invite @Claude Code Bridge
```

채널 ID 확인: Slack에서 채널 우클릭 → **Channel details** → 하단의 ID 복사

## 설치 및 환경 설정

```bash
# 의존성 설치
npm install

# 환경변수 파일 생성
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

## 프로젝트 구조

```
mcp-slack-bridge/
├── apps/
│   ├── bot-service/              # Slack Bot 서비스
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── slack/            # Slack 연동 모듈
│   │       ├── poller/           # 세션 디렉토리 폴링
│   │       └── executor/         # 원격 실행 (Phase 5)
│   │
│   └── mcp-server/               # MCP 서버 (stdio)
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── session/          # 세션 관리
│           ├── mcp/              # MCP 도구 (ask, notify, wait)
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
│       └── notifications/        # 알림 메시지
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
| Phase 4 | Hook 스크립트 (Claude Code 이벤트 연동) | 미구현 |
| Phase 5 | Slack 명령어 확장 (원격 실행, 세션 관리) | 미구현 |
| Phase 6 | 안정화 및 배포 (모니터링, 문서화, CI/CD) | 미구현 |

## 라이선스

UNLICENSED - Private project
