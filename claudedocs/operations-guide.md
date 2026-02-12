# MCP Slack Bridge 운영 가이드

## 개요

MCP Slack Bridge는 Claude Code 세션과 Slack을 연결하는 브릿지 시스템입니다.
Bot 서비스와 MCP 서버 두 컴포넌트로 구성됩니다.

---

## 1. 개발 환경 실행

### 사전 요구사항
- Node.js 18.x 이상
- npm
- Slack App 설정 완료 (`.env` 파일)

### 빌드 및 실행

```bash
# 의존성 설치
npm ci

# 전체 빌드
npm run build:all

# Bot 서비스 실행 (개발 모드)
npm run start:bot:dev

# MCP 서버 실행 (개발 모드)
npm run start:mcp:dev
```

### 개별 빌드

```bash
npm run build:shared   # 공유 라이브러리
npm run build:bot      # Bot 서비스
npm run build:mcp      # MCP 서버
npm run build:hooks    # Hook 스크립트
```

---

## 2. 프로덕션 실행

### 직접 실행

```bash
# 빌드
npm run build:all

# Bot 서비스 실행
NODE_ENV=production SKIP_WIZARD=true node dist/apps/bot-service/main.js
```

### pm2를 사용한 실행

#### pm2 설치

```bash
npm install -g pm2
```

#### 시작/중지/재시작

```bash
# 시작
npm run pm2:start

# 중지
npm run pm2:stop

# 재시작
npm run pm2:restart

# 로그 확인
npm run pm2:logs
```

#### pm2 모니터링

```bash
# 프로세스 상태 확인
pm2 status

# 실시간 모니터링
pm2 monit

# 상세 정보
pm2 show mcp-slack-bridge
```

#### 부팅 시 자동 시작

```bash
# 시작 스크립트 생성
pm2 startup

# 현재 프로세스 목록 저장
pm2 save
```

---

## 3. 로그 관리

### 로그 위치
- pm2 사용 시: `logs/out.log`, `logs/error.log`
- 직접 실행 시: stdout/stderr

### 로그 로테이션 (pm2)

```bash
# pm2-logrotate 설치
pm2 install pm2-logrotate

# 설정 (예: 최대 10MB, 30개 파일 보관)
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### 로그 레벨
- Bot 서비스: `error`, `warn`, `log` (NestJS Logger)
- MCP 서버: `error`, `warn` (stdout 보호)

---

## 4. 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SLACK_BOT_TOKEN` | Slack Bot 토큰 | 필수 |
| `SLACK_APP_TOKEN` | Slack App 토큰 | 필수 |
| `SLACK_CHANNEL_ID` | 기본 채널 ID | 필수 |
| `ALLOWED_USER_IDS` | 허용 사용자 ID (쉼표 구분) | 필수 |
| `ALLOWED_CHANNEL_IDS` | 허용 채널 ID (쉼표 구분) | 비어있으면 전체 허용 |
| `STATE_DIR` | 상태 디렉토리 | `./state` |
| `CLAUDE_WORKING_DIR` | 작업 디렉토리 | 현재 디렉토리 |
| `POLL_INTERVAL_MS` | 폴링 간격 (ms) | `2000` |
| `NOTIFICATION_DELAY_SECONDS` | 알림 지연 (초) | `0` |
| `SESSION_TIMEOUT_MS` | 세션 타임아웃 (ms) | `3600000` |
| `HEARTBEAT_INTERVAL_MS` | 하트비트 간격 (ms) | `30000` |
| `STALE_SESSION_MS` | 비활성 세션 판정 (ms) | `300000` |
| `MAX_CONCURRENT_EXECUTIONS` | 최대 동시 실행 | `1` |
| `MAX_QUEUE_SIZE` | 최대 큐 크기 | `5` |
| `EXECUTION_TIMEOUT_MS` | 실행 타임아웃 (ms) | `600000` |
| `MAX_PROMPT_LENGTH` | 최대 프롬프트 길이 | `2000` |
| `SKIP_WIZARD` | Setup Wizard 건너뛰기 | `false` |

---

## 5. 자동 정리

### 세션 정리
- 비활성 세션 (heartbeat 미수신 5분): 자동으로 `terminated` 상태 변경
- terminated 세션 디렉토리: 1시간 후 자동 삭제

### 작업 큐 정리
- 완료/실패/취소된 작업: 1시간마다 자동 정리

---

## 6. 보안 설정

### 사용자 권한
- `ALLOWED_USER_IDS`에 등록된 Slack 사용자만 명령 실행 가능

### 채널 권한
- `ALLOWED_CHANNEL_IDS`가 설정되면 해당 채널에서만 사용 가능
- 비어있으면 모든 채널에서 사용 가능

### 명령어 제한
- `BLOCKED_COMMANDS`: 실행 차단 명령어
- `CONFIRM_COMMANDS`: 확인 필요 명령어
