# Slack 명령어 실행 방식 비교 가이드

mcp-slack-bridge는 Slack에서 Claude Code에 작업을 요청하는 **두 가지 방식**을 제공합니다. 이 문서에서는 각 방식의 동작 원리, 장단점, 그리고 상황별 사용 가이드를 설명합니다.

---

## 1. 개요

| 방식 | 핵심 특징 |
|------|----------|
| `/claude` Slash Command | 새 프로세스를 생성하여 비대화식으로 실행. **완료 후 결과만** Slack에 반환 |
| Session Remote Command | 기존 실행 중인 Claude Code 세션에 파일 기반으로 명령 전달. **PC 터미널에서 실시간 확인** 가능 |

---

## 2. `/claude` Slash Command 상세

### 동작 원리

Bot의 `ExecutorService`가 새로운 Claude CLI 프로세스를 생성합니다.

```typescript
// apps/bot-service/src/executor/executor.service.ts:167
const proc = spawn('claude', ['-p', modePrompt, '--output-format', 'json'], {
  cwd: workingDir,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],  // stdin: 무시, stdout/stderr: 파이프
});
```

- `claude -p` : **비대화식(non-interactive) 모드** — 프롬프트를 받아 한 번 실행 후 종료
- `--output-format json` : 결과를 JSON으로 반환
- `stdio: ['ignore', 'pipe', 'pipe']` : stdin 없음, stdout/stderr를 Bot이 수집

### 실행 흐름

```
사용자 (Slack)
  │
  ▼
/claude "코드 분석해줘"
  │
  ▼
Bot Service (ExecutorService)
  │  spawn('claude', ['-p', prompt, '--output-format', 'json'])
  ▼
새 Claude 프로세스 (비대화식)
  │  - 독립 프로세스로 실행
  │  - PC 터미널에 표시되지 않음
  │  - stdout/stderr → Bot이 파이프로 수집
  ▼
실행 완료 → JSON 결과 반환
  │
  ▼
Bot → Slack 쓰레드에 결과 게시
```

### 실시간 모니터링이 불가능한 이유

1. **별도 프로세스**: `spawn()`으로 생성된 독립 프로세스이므로 기존 터미널 세션과 무관
2. **비대화식 모드**: `-p` 플래그로 인해 프롬프트를 받고 한 번 실행 후 종료
3. **출력 파이프**: stdout/stderr가 Bot에 파이프되어 터미널이 아닌 Bot만 출력을 수신
4. **백그라운드 실행**: 사용자 PC의 터미널에 아무 표시 없이 실행되고 완료됨

### 장점

- **세션 불필요**: Claude Code 세션이 실행 중이지 않아도 사용 가능
- **독립 실행**: 기존 작업에 영향 없이 별도 작업 수행
- **큐 관리**: 여러 작업을 순차적으로 처리하는 큐 시스템 내장
- **모드 지원**: `plan`, `brainstorm`, `analyze`, `review` 등 다양한 실행 모드
- **외출 중 사용**: PC 앞에 없어도 Slack에서 작업 요청 가능

### 한계

- **실시간 확인 불가**: 작업 진행 과정을 볼 수 없음 (완료 후 결과만)
- **매번 새 컨텍스트**: 이전 대화 맥락이 유지되지 않음
- **긴 작업 시 대기**: 복잡한 작업은 완료까지 시간이 소요되며 중간 상태 확인 불가
- **상호작용 불가**: 실행 중 추가 지시나 방향 전환이 어려움

---

## 3. Session Remote Command 상세

### 동작 원리

Slack에서 보낸 명령이 파일 시스템을 통해 기존 실행 중인 Claude Code 세션에 전달됩니다.

1. **Bot** → 세션 디렉토리에 `commands/cmd-{timestamp}.json` 파일 생성
2. **MCP 서버** (`slack_check_commands`) → 폴링하여 보류 명령 수신
3. **Claude Code 세션** → 기존 터미널에서 명령 실행
4. **MCP 서버** (`slack_command_result`) → 결과를 `command-results/` 디렉토리에 기록
5. **Bot** → 결과 파일 감지 → Slack 쓰레드에 게시

### 실행 흐름

```
사용자 (Slack 세션 쓰레드)
  │
  ▼
"@claude 이 함수 리팩토링해줘"
  │
  ▼
Bot Service → commands/cmd-{timestamp}.json 생성
  │  { commandId, command, requestedBy, createdAt }
  ▼
MCP Server: slack_check_commands (폴링)
  │  - 블로킹 모드: 새 명령이 올 때까지 대기 (기본 5분 타임아웃)
  │  - 명령 수신 시 status를 'received'로 업데이트
  ▼
기존 Claude Code 세션에서 실행
  │  ← PC 터미널에서 실시간 확인 가능!
  ▼
MCP Server: slack_command_result
  │  → command-results/result-{commandId}.json 생성
  ▼
Bot 폴링 → 결과 감지 → Slack 쓰레드에 게시
```

### 실시간 모니터링이 가능한 이유

1. **기존 세션 사용**: 이미 열려있는 Claude Code 터미널 세션에서 실행
2. **터미널 출력 유지**: 새 프로세스가 아닌 기존 세션이므로 모든 출력이 터미널에 표시
3. **대화형 모드**: Claude Code의 대화형 인터페이스 그대로 사용
4. **양방향 통신**: Slack → 세션, 세션 → Slack 양방향으로 정보 전달

### 장점

- **실시간 확인**: PC 터미널에서 Claude Code가 무엇을 하고 있는지 실시간으로 확인
- **컨텍스트 유지**: 기존 대화 맥락과 작업 내용이 유지됨
- **연속 작업**: 이전 지시에 이어서 추가 작업 가능
- **양방향 통신**: 파일 기반 `commands/` → `command-results/` 양방향 통신
- **다중 세션 관리**: 여러 세션을 동시에 운용하며 각 세션에 별도 지시 가능

### 한계

- **활성 세션 필요**: Claude Code 세션이 PC에서 실행 중이어야 함
- **MCP 설정 필요**: mcp-server가 Claude Code에 등록되어 있어야 함
- **폴링 의존**: `slack_check_commands`를 Claude Code가 주기적으로 호출해야 함
- **PC 종속**: 세션이 실행 중인 PC가 켜져 있어야 함

---

## 4. 상세 비교표

| 항목 | `/claude` Slash Command | Session Remote Command |
|------|------------------------|----------------------|
| **실행 방식** | `spawn('claude', ['-p', ...])` 새 프로세스 | 파일 기반 명령 전달 → 기존 세션 |
| **실시간 모니터링** | 불가 (백그라운드 실행) | 가능 (PC 터미널에서 확인) |
| **작업 컨텍스트** | 매번 새로운 컨텍스트 | 기존 세션 컨텍스트 유지 |
| **결과 확인** | Slack 쓰레드에 완료 메시지 | Slack + PC 터미널 동시 확인 |
| **세션 필요 여부** | 불필요 (Bot이 자동 생성/종료) | 활성 세션 필수 |
| **중단 제어** | `/claude-cancel` 또는 `@claude stop` | 세션에서 Ctrl+C |
| **모드 지원** | plan, brainstorm, analyze, review | 세션 내 자유 지시 |
| **통신 방식** | stdout/stderr 파이프 | 파일 시스템 (commands/ ↔ command-results/) |
| **MCP 도구** | 사용 안 함 | `slack_check_commands`, `slack_command_result` |
| **큐 관리** | 내장 큐 시스템 | 세션별 독립 처리 |
| **외출 중 사용** | 가능 | 불가 (PC 앞에서 확인해야 의미 있음) |
| **연속 대화** | 불가 (매번 독립 실행) | 가능 (세션 컨텍스트 유지) |

---

## 5. 사용 시나리오별 가이드

### 시나리오 A: 외출 중 간단한 작업 요청

**상황**: 이동 중에 모바일 Slack에서 간단한 코드 생성을 요청하고 싶다.

**추천**: `/claude`

```
/claude "UserService에 이메일 검증 유틸 함수 추가해줘"
```

- PC가 꺼져 있거나 세션이 없어도 Bot이 자동으로 처리
- 완료 후 Slack에서 결과 확인

---

### 시나리오 B: PC 앞에서 작업 중, 추가 지시

**상황**: 터미널에서 Claude Code로 리팩토링 작업 중인데, Slack에서도 추가 지시를 보내고 싶다.

**추천**: Session Remote Command

```
[세션 쓰레드에서]
@claude "방금 리팩토링한 함수에 에러 핸들링도 추가해줘"
```

- PC 터미널에서 Claude Code가 실시간으로 작업하는 모습 확인
- 이전 리팩토링 맥락이 유지되어 정확한 작업 수행

---

### 시나리오 C: 코드 리뷰

**상황**: PR에 대한 코드 리뷰를 요청하고 싶다.

**추천**: `/claude` (review 모드)

```
/claude review "PR #42의 변경사항을 리뷰해줘"
```

- 독립적인 리뷰 작업이므로 별도 프로세스로 실행
- 리뷰 결과가 구조화된 형태로 Slack에 반환

---

### 시나리오 D: 디버깅 중 실시간 확인

**상황**: 복잡한 버그를 디버깅하면서 Claude Code의 분석 과정을 실시간으로 보고 싶다.

**추천**: Session Remote Command

```
[세션 쓰레드에서]
@claude "이 에러의 root cause를 분석하고 파일별로 수정해줘"
```

- 터미널에서 Claude Code가 어떤 파일을 읽고, 어떤 분석을 하는지 실시간 확인
- 잘못된 방향으로 가면 즉시 Ctrl+C로 중단 가능
- 중간에 추가 힌트나 방향 전환 지시 가능

---

### 시나리오 E: 여러 터미널에서 동시 작업

**상황**: 프론트엔드와 백엔드를 각각 다른 터미널에서 동시에 작업 중이다.

**추천**: Session Remote Command (세션별 쓰레드)

```
[프론트엔드 세션 쓰레드]
@claude "컴포넌트 스타일 수정해줘"

[백엔드 세션 쓰레드]
@claude "API 엔드포인트 추가해줘"
```

- 각 세션이 별도 Slack 쓰레드를 가지므로 독립적으로 지시/확인 가능
- Bot이 새 세션을 자동 감지하여 Slack 쓰레드 생성

---

## 6. 설정 방법 요약

### `/claude` Slash Command 사용에 필요한 설정

1. **Slack App 설정**: Slash Command (`/claude`, `/claude-cancel`, `/claude-sessions` 등) 등록
2. **Bot Service 실행**: `npm run start:bot` 또는 `npm run dev`
3. **환경 변수**: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` 설정

추가 설정 없이 Bot이 실행 중이면 바로 사용 가능합니다.

### Session Remote Command 사용에 필요한 설정

1. **위의 `/claude` 설정 모두** +
2. **MCP 서버 등록**: Claude Code의 MCP 설정에 mcp-server 추가
   ```json
   {
     "mcpServers": {
       "mcp-slack-bridge": {
         "command": "node",
         "args": ["path/to/mcp-server/dist/main.js"]
       }
     }
   }
   ```
3. **Claude Code 세션 활성화**: 터미널에서 Claude Code 실행
4. **`slack_check_commands` 호출**: Claude Code가 주기적으로 이 MCP 도구를 호출하여 새 명령을 폴링

> Setup Wizard(`/setup`)를 사용하면 위의 설정을 웹 UI로 간편하게 완료할 수 있습니다.
