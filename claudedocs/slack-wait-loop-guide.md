# Slack 명령 대기 루프 & Stop Hook 사용 가이드

이 문서는 Claude Code가 Slack에서 전달되는 명령을 자동으로 수신하고 처리하는 **대기 루프 시스템**의 설정 방법과 동작 원리를 설명합니다.

## 개요

mcp-slack-bridge는 Claude Code가 작업을 완료한 후에도 Slack 명령을 계속 수신할 수 있도록 **3중 안전망**을 제공합니다:

```
Layer 1: CLAUDE.md ─── LLM에게 대기 루프 진입 지시 (소프트 가이드)
Layer 2: PostToolUse Hook ─── 도구 사용 시마다 대기 상태 리마인더
Layer 3: Stop Hook ─── LLM 정지 시도를 차단하고 대기 루프 강제 진입
```

## 동작 흐름

```
Claude Code 작업 시작
      │
      ▼
  작업 수행 (코드 편집, 분석 등)
      │
      ▼ ← PostToolUse Hook: "Slack 명령 대기하세요" 리마인더
      │
  작업 완료
      │
      ├─ [정상] → slack_check_commands(blocking=true) 호출 → 명령 대기
      │                    │
      │                    ├─ 명령 수신 → 실행 → slack_command_result → 다시 대기
      │                    └─ 타임아웃 → 즉시 재호출 → 다시 대기
      │
      └─ [LLM이 멈추려 함] → Stop Hook 발동
                    │
                    ├─ 차단 횟수 < 5 → {"decision":"block"} → 대기 루프 강제 진입
                    └─ 차단 횟수 ≥ 5 → Circuit Breaker → 세션 정리 후 정지 허용
```

## 설정 방법

### 1단계: 빌드

```bash
# 전체 빌드 (hooks 포함)
npm run build:all

# 또는 hooks만 빌드
npm run build:hooks
```

### 2단계: Hook 등록

프로젝트의 `.claude/settings.local.json`에 아래 hooks 설정을 추가합니다:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node dist/hooks/hooks/on-check-commands.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node dist/hooks/hooks/on-stop.js"
          }
        ]
      }
    ]
  }
}
```

> **경로 참고**: `command`의 경로는 프로젝트 루트(`mcp-slack-bridge/`) 기준입니다. 다른 프로젝트에서 사용하려면 절대 경로를 사용하세요.

### 3단계: CLAUDE.md 설정

프로젝트 루트에 `CLAUDE.md` 파일을 생성하여 Claude Code에게 대기 루프 진입을 지시합니다:

```markdown
## Slack 명령 대기 워크플로우

이 프로젝트는 mcp-slack-bridge를 통해 Slack @mention 명령을 수신합니다.

### 필수 규칙
1. **작업 완료 후 대기 진입**: 현재 작업이 끝나면 `slack_check_commands`를 `blocking=true`로 호출하여 Slack 명령 대기 상태로 진입하세요.
2. **명령 처리 후 재대기**: Slack 명령을 처리하고 `slack_command_result`로 결과를 보고한 후, 다시 `slack_check_commands(blocking=true)`를 호출하세요.
3. **타임아웃 시 재호출**: `slack_check_commands`가 타임아웃으로 반환되면 즉시 다시 호출하여 대기를 계속하세요.
```

### 4단계: MCP 서버 등록

Claude Code에 MCP 서버가 등록되어 있어야 합니다 (`~/.claude.json` 또는 `.claude/settings.local.json`):

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

### 5단계: Bot 서비스 실행

Bot 서비스가 상시 실행되어야 Slack 메시지를 수신할 수 있습니다:

```bash
# 개발 모드
npm run start:bot:dev

# 프로덕션 (pm2)
npx pm2 start ecosystem.config.js
```

## 핵심 컴포넌트

### Stop Hook (`hooks/on-stop.ts`)

Claude Code가 응답을 완료하고 멈추려 할 때 발동됩니다.

| 동작 | 조건 | 결과 |
|------|------|------|
| **차단** | 차단 횟수 < 5 | `{"decision":"block","reason":"..."}` 출력, 대기 루프 강제 진입 |
| **허용 (Circuit Breaker)** | 차단 횟수 ≥ 5 | 카운터 리셋, 세션 정리, 정지 허용 |
| **허용 (명시적 종료)** | `.no-wait-loop` 플래그 존재 | 플래그 삭제, 세션 정리, 정지 허용 |
| **허용 (세션 없음)** | 활성 세션 없음 | 정지 허용 |

**상태 파일:**
- `.stop-block-count` — 연속 차단 횟수 (세션 디렉토리에 저장)
- `.no-wait-loop` — 명시적 종료 플래그 (Slack `exit` 명령으로 생성)

### PostToolUse Hook (`hooks/on-check-commands.ts`)

Claude Code가 도구를 사용할 때마다 발동됩니다.

| 동작 | 조건 |
|------|------|
| **카운터 리셋** | `slack_check_commands` 호출 시 → 대기 루프 활성 증명 |
| **카운터 리셋** | `slack_command_result` 호출 시 → 활성 처리 증명 |
| **스킵** | `slack_ask`, `slack_notify`, `slack_wait_response` → 무한 루프 방지 |
| **초기 안내** | 세션 최초 도구 사용 시 → 대기 루프 진입 안내 메시지 |
| **명령 감지** | 대기 중인 Slack 명령이 있으면 → 리마인더 출력 |
| **쿨다운** | 10초 이내 중복 알림 방지 |

### MCP 도구

| 도구 | 역할 |
|------|------|
| `slack_check_commands` | Slack 명령 수신 대기 (blocking=true로 호출) |
| `slack_command_result` | 명령 실행 결과를 Slack에 보고 |

## Slack에서 사용하기

### 명령 보내기

세션 쓰레드에서 `@claude` 멘션으로 명령을 전달합니다:

```
@claude 프로젝트 구조를 분석해줘
@claude 테스트를 실행해줘
@claude status    ← 세션 상태 확인
@claude exit      ← 세션 종료 (대기 루프 중단)
```

### 세션 종료하기

대기 루프를 중단하고 Claude Code 세션을 종료하려면:

1. **Slack에서**: `@claude exit` 명령 → `.no-wait-loop` 플래그 생성 → 다음 Stop Hook에서 정지 허용
2. **자동 종료**: 연속 5회 차단 후 Circuit Breaker가 자동으로 정지 허용
3. **수동 종료**: 터미널에서 `Ctrl+C`로 강제 종료

## 문제 해결

### Claude Code가 대기 루프에 진입하지 않음

1. `CLAUDE.md`가 프로젝트 루트에 있는지 확인
2. Hook이 `.claude/settings.local.json`에 등록되어 있는지 확인
3. `dist/hooks/hooks/on-stop.js`가 빌드되어 있는지 확인 (`npm run build:hooks`)

### 대기 루프가 계속 끊김

1. Circuit Breaker 카운터를 확인: `state/sessions/{uuid}/.stop-block-count`
2. 카운터가 5에 도달하면 자동 종료됨 → 카운터가 리셋되려면 `slack_check_commands` 호출 필요

### Slack 명령이 전달되지 않음

1. Bot 서비스가 실행 중인지 확인 (`npm run start:bot`)
2. 세션 쓰레드에서 `@claude` 멘션을 사용하는지 확인
3. `state/sessions/{uuid}/commands/` 디렉토리에 명령 파일이 생성되는지 확인

### 세션을 종료할 수 없음

- Slack에서 `@claude exit` 명령을 보내면 `.no-wait-loop` 플래그가 생성됩니다
- 플래그가 존재하면 다음 Stop Hook에서 정지가 허용됩니다
- 긴급 시 터미널에서 `Ctrl+C`로 강제 종료 가능

## 안전 장치

| 장치 | 설명 |
|------|------|
| **Circuit Breaker** | 연속 5회 차단 후 자동 정지 허용 (무한 루프 방지) |
| **`.no-wait-loop` 플래그** | Slack `exit` 명령으로 명시적 종료 가능 |
| **쿨다운** | PostToolUse Hook의 알림 중복 방지 (10초) |
| **세션 정리** | 정지 허용 시 meta.json terminated, 질문 expired, .current-session 삭제 |
| **세션 없음 허용** | 활성 세션이 없으면 Stop Hook이 정지를 허용 |

## 아키텍처 다이어그램

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Claude Code Session                        │
│                                                                      │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────────┐       │
│  │ CLAUDE.md│───▶│ LLM이 대기   │───▶│ slack_check_commands │       │
│  │ 지시     │    │ 루프 진입    │    │ (blocking=true)       │       │
│  └─────────┘    └──────────────┘    └───────────┬───────────┘       │
│                                                  │                   │
│       ┌──────────────┐              ┌────────────▼────────────┐     │
│       │ PostToolUse  │              │  Slack 명령 수신 대기    │     │
│       │ Hook         │              │  (5분 타임아웃)         │     │
│       │ - 리마인더    │              └────────────┬────────────┘     │
│       │ - 카운터 리셋 │                           │                  │
│       └──────────────┘              ┌────────────▼────────────┐     │
│                                     │  명령 실행              │     │
│       ┌──────────────┐              │  → slack_command_result │     │
│       │ Stop Hook    │              └────────────┬────────────┘     │
│       │ - 정지 차단   │                           │                  │
│       │ - 대기 강제   │              ┌────────────▼────────────┐     │
│       │ - 서킷 브레이커│◀────────────│  다시 대기 루프 진입     │     │
│       └──────────────┘              └─────────────────────────┘     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 파일 기반 IPC
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Bot Service (상시 실행)                           │
│                                                                      │
│  Slack @mention → commands/{uuid}.json → MCP 폴링 → Claude 실행    │
│  Claude 결과 → command-results/{uuid}.json → Bot 폴링 → Slack 게시  │
└──────────────────────────────────────────────────────────────────────┘
```
