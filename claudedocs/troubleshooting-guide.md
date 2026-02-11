# MCP Slack Bridge 트러블슈팅 가이드

## 1. Slack 연결 실패

### 증상
- Bot 서비스 시작 시 `Slack Bot started` 메시지가 출력되지 않음
- `Error: An API error occurred: invalid_auth` 에러

### 원인 및 해결

| 원인 | 해결 방법 |
|------|----------|
| 잘못된 토큰 | `.env`의 `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` 확인 |
| Socket Mode 미활성화 | Slack App 설정 > Socket Mode 활성화 |
| 필요한 스코프 누락 | Bot Token Scopes: `chat:write`, `app_mentions:read`, `commands` |
| 네트워크 문제 | 방화벽/프록시 설정 확인 |

### 확인 방법
```bash
# Bot 토큰 테스트
curl -H "Authorization: Bearer xoxb-YOUR-TOKEN" https://slack.com/api/auth.test
```

---

## 2. 세션 미감지

### 증상
- MCP 서버가 실행 중이지만 Slack에 세션이 표시되지 않음
- `/claude-sessions` 결과가 비어있음

### 원인 및 해결

| 원인 | 해결 방법 |
|------|----------|
| STATE_DIR 불일치 | Bot과 MCP 서버의 `STATE_DIR` 경로가 동일한지 확인 |
| 권한 문제 | STATE_DIR 디렉토리 읽기/쓰기 권한 확인 |
| 세션 만료 | `STALE_SESSION_MS` 값 확인 (기본 5분) |
| 폴링 간격 | `POLL_INTERVAL_MS` 값 확인 (기본 2초) |

### 확인 방법
```bash
# 세션 디렉토리 확인
ls state/sessions/

# 세션 메타 확인
cat state/sessions/<session-id>/meta.json
```

---

## 3. 질문 미전송

### 증상
- MCP 서버에서 `slack_ask`를 호출했으나 Slack에 메시지가 나타나지 않음

### 원인 및 해결

| 원인 | 해결 방법 |
|------|----------|
| 알림 지연 | `NOTIFICATION_DELAY_SECONDS` 확인 (기본 300초 = 5분) |
| 채널 ID 오류 | `SLACK_CHANNEL_ID`가 올바른지 확인 |
| Bot 미실행 | Bot 서비스가 실행 중인지 확인 |
| 파일 쓰기 실패 | MCP 서버 로그에서 `[FileBridge]` 에러 확인 |

### 빠른 테스트를 위한 설정
```env
# 알림 지연을 0초로 설정
NOTIFICATION_DELAY_SECONDS=0
```

### 확인 방법
```bash
# 질문 파일 확인
ls state/sessions/<session-id>/questions/

# 질문 상태 확인
cat state/sessions/<session-id>/questions/<question-id>.json
```

---

## 4. 메모리 이슈

### 증상
- pm2에서 `max_memory_restart` 발동으로 반복 재시작
- 메모리 사용량이 지속적으로 증가

### 원인 및 해결

| 원인 | 해결 방법 |
|------|----------|
| 세션 미정리 | 정상 동작: 1시간 후 terminated 세션 자동 삭제 |
| 큐 미정리 | 정상 동작: 1시간마다 완료된 작업 자동 정리 |
| 대량 세션 | `MAX_ACTIVE_SESSIONS` 제한 설정 |
| Node.js 힙 | `--max-old-space-size=512` 옵션 추가 |

### 모니터링
```bash
# pm2 메모리 모니터링
pm2 monit

# Node.js 힙 사용량
node -e "console.log(process.memoryUsage())"
```

---

## 5. 명령 실행 실패

### 증상
- `/claude` 명령 실행 후 결과가 나오지 않음
- 작업이 `failed` 상태

### 원인 및 해결

| 원인 | 해결 방법 |
|------|----------|
| Claude CLI 미설치 | `claude --version` 확인 |
| PATH 문제 | pm2 사용 시 절대 경로 확인 |
| 타임아웃 | `EXECUTION_TIMEOUT_MS` 증가 (기본 10분) |
| 차단된 명령 | `BLOCKED_COMMANDS` 목록 확인 |
| 큐 가득 참 | `/claude-status`로 큐 상태 확인 |

### 확인 방법
```bash
# 큐 상태 직접 확인
cat state/execution-queue.json | jq '.queue[] | {id: .id[0:8], status, prompt}'

# Claude CLI 테스트
claude -p "hello" --output-format json
```

---

## 6. Hook 스크립트 문제

### 증상
- Claude Code에서 Hook이 실행되지 않음
- 세션이 자동 생성되지 않음

### 원인 및 해결

| 원인 | 해결 방법 |
|------|----------|
| Hook 미등록 | `.claude/settings.json`에 hook 경로 확인 |
| 빌드 미완료 | `npm run build:hooks` 실행 |
| 경로 오류 | hook 스크립트의 절대 경로 확인 |
| 권한 문제 | Unix: `chmod +x hooks/dist/*.js` |

---

## 7. 에러 코드 참조

| 에러 | 설명 | 해결 |
|------|------|------|
| `no_session` | MCP 도구 호출 시 활성 세션 없음 | MCP 서버 재시작 |
| `timeout` | 응답 대기 시간 초과 | `timeout` 파라미터 증가 |
| `write_failed` | 파일 쓰기 실패 | STATE_DIR 권한 확인 |
| `internal_error` | 내부 처리 오류 | MCP 서버 로그 확인 |
| `invalid_auth` | Slack 인증 실패 | 토큰 재확인 |
| `Queue is full` | 작업 큐 가득 참 | 기존 작업 완료 대기 또는 `MAX_QUEUE_SIZE` 증가 |

---

## 8. 디버깅 팁

### 로그 실시간 확인
```bash
# pm2 사용 시
pm2 logs mcp-slack-bridge --lines 100

# 직접 실행 시
npm run start:bot 2>&1 | tee debug.log
```

### 상태 파일 모니터링
```bash
# 세션 변경 감시 (Linux/macOS)
watch -n 1 'ls -la state/sessions/'

# Windows PowerShell
while ($true) { cls; Get-ChildItem state\sessions\; Start-Sleep 1 }
```

### MCP 서버 디버그 모드
```bash
# stderr 출력을 파일로 리다이렉트
node dist/apps/mcp-server/main.js 2> mcp-debug.log
```
