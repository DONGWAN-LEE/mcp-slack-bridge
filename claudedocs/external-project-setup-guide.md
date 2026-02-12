# 다른 프로젝트에서 Slack Bridge 사용하기 — 퀵 스타트 가이드

이 문서는 mcp-slack-bridge가 아닌 **다른 프로젝트**에서 Claude Code를 Slack으로 원격 제어하기 위한 설정 방법을 안내합니다.

## 사전 준비

- mcp-slack-bridge가 빌드되어 있어야 합니다 (`npm run build:all`)
- Bot 서비스가 실행 중이어야 합니다 (`npm run start:bot` 또는 pm2)
- Slack App 설정이 완료되어 있어야 합니다 (`.env` 파일 존재)

## 전체 구조

```
┌─────────────────────────────┐
│  대상 프로젝트 (예: my-app)   │
│                             │
│  .claude/                   │
│  ├── settings.local.json ◄──┼── MCP 서버 등록 + Hook 등록
│  CLAUDE.md ◄────────────────┼── 대기 루프 지시
│                             │
│  Claude Code 세션            │
│  └── slack_check_commands() │
└──────────┬──────────────────┘
           │ 파일 기반 IPC
           ▼
┌─────────────────────────────┐
│  mcp-slack-bridge           │
│  ├── Bot 서비스 (상시 실행)   │
│  ├── MCP 서버 (세션당 자동)   │
│  └── state/sessions/        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Slack                      │
│  └── @claude 명령 → 실행     │
└─────────────────────────────┘
```

---

## Step 1: CLAUDE.md 파일 생성

대상 프로젝트의 **루트 디렉토리**에 `CLAUDE.md` 파일을 생성합니다.

아래 내용을 **그대로 복사**하세요:

```markdown
<!-- DO NOT DELETE: This file guides Claude Code's wait loop behavior for Slack command detection -->

## Slack 명령 대기 워크플로우

이 프로젝트는 mcp-slack-bridge를 통해 Slack @mention 명령을 수신합니다.

### 필수 규칙
1. **작업 완료 후 대기 진입**: 현재 작업이 끝나면 `slack_check_commands`를 `blocking=true`로 호출하여 Slack 명령 대기 상태로 진입하세요.
2. **명령 처리 후 재대기**: Slack 명령을 처리하고 `slack_command_result`로 결과를 보고한 후, 다시 `slack_check_commands(blocking=true)`를 호출하세요.
3. **타임아웃 시 재호출**: `slack_check_commands`가 타임아웃으로 반환되면 즉시 다시 호출하여 대기를 계속하세요.
```

> **이 파일이 하는 일**: Claude Code(LLM)에게 "작업이 끝나면 Slack 명령을 기다려라"고 지시합니다. 이 지시가 없으면 Claude Code는 작업 완료 후 바로 멈춰버립니다.

---

## Step 2: MCP 서버 등록

Claude Code가 `slack_check_commands`, `slack_command_result` 등의 도구를 사용하려면 MCP 서버를 등록해야 합니다.

### 방법 A: 글로벌 등록 (권장 — 모든 프로젝트에서 자동 사용)

`~/.claude.json` 파일을 열고 `mcpServers` 섹션에 추가합니다:

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

### 방법 B: 프로젝트별 등록 (특정 프로젝트에서만 사용)

대상 프로젝트의 `.claude/settings.local.json` 파일에 추가합니다.

파일이 없으면 `.claude/` 디렉토리를 만들고 `settings.local.json`을 생성하세요:

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

> **경로 수정 필수**: `args`와 `STATE_DIR`의 경로를 mcp-slack-bridge가 설치된 **실제 절대 경로**로 변경하세요.
>
> **Windows 경로**: 슬래시(`/`) 또는 이중 백슬래시(`\\`)를 사용하세요.
> - `"C:/program1/gameServer/mcp-slack-bridge/..."` (권장)
> - `"C:\\program1\\gameServer\\mcp-slack-bridge\\..."` (대안)

---

## Step 3: Hook 스크립트 등록

Hook은 Claude Code가 멈추려 할 때 강제로 대기 루프를 유지하는 **핵심 안전장치**입니다.

대상 프로젝트의 `.claude/settings.local.json`에 `hooks` 섹션을 추가합니다:

### 최소 설정 (대기 루프만)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-check-commands.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-stop.js"
          }
        ]
      }
    ]
  }
}
```

### 전체 설정 (대기 루프 + 질문 전달 + 알림)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-question-asked.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-question-answered.js"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-check-commands.js"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-notification.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-stop.js"
          }
        ]
      }
    ]
  }
}
```

> **경로 수정 필수**: 모든 `command`의 경로를 mcp-slack-bridge의 **실제 절대 경로**로 변경하세요.

### Hook 역할 설명

| Hook | 파일 | 역할 |
|------|------|------|
| **Stop** | `on-stop.js` | LLM이 멈추려 할 때 차단하고 대기 루프 강제 진입 (필수) |
| **PostToolUse** | `on-check-commands.js` | 도구 사용 시마다 대기 상태 리마인더 + 카운터 리셋 (필수) |
| **PreToolUse (AskUserQuestion)** | `on-question-asked.js` | Claude의 질문을 Slack으로 전달 (선택) |
| **PostToolUse (AskUserQuestion)** | `on-question-answered.js` | Slack 응답을 Claude에 전달 (선택) |
| **Notification** | `on-notification.js` | 알림 이벤트 처리 (선택) |

---

## Step 4: 전체 settings.local.json 예시

MCP 서버 등록과 Hook을 모두 포함한 **완전한 `.claude/settings.local.json`** 예시입니다.

이 파일을 대상 프로젝트의 `.claude/settings.local.json`으로 복사하고 경로만 수정하세요:

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
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-question-asked.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-question-answered.js"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-check-commands.js"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-notification.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/program1/gameServer/mcp-slack-bridge/dist/hooks/hooks/on-stop.js"
          }
        ]
      }
    ]
  }
}
```

---

## Step 5: 확인 및 테스트

### 1. Bot 서비스 실행 확인

```bash
# mcp-slack-bridge 디렉토리에서
pm2 status
# 또는
npm run start:bot
```

### 2. Claude Code 시작

대상 프로젝트 디렉토리에서 Claude Code를 실행합니다:

```bash
# VS Code 터미널, Windows Terminal 등에서
claude
```

### 3. 대기 루프 진입 확인

Claude Code에 다음과 같이 입력합니다:

```
대기루프 진입해
```

Claude Code가 `slack_check_commands(blocking=true)`를 호출하면 성공입니다.

### 4. Slack에서 명령 전달

Slack의 세션 쓰레드에서:

```
@claude 테스트 명령입니다
```

Claude Code가 명령을 수신하고 실행하면 설정이 완료된 것입니다.

---

## 문제 해결

### "slack_check_commands 도구를 찾을 수 없음"

- MCP 서버가 등록되지 않았습니다
- `.claude/settings.local.json` 또는 `~/.claude.json`에 `mcpServers.slack-bridge` 설정을 확인하세요
- 경로가 올바른지 확인: `dist/apps/mcp-server/main.js` 파일이 존재하는지 확인

### "Claude Code가 작업 후 바로 멈춤"

- `CLAUDE.md` 파일이 프로젝트 루트에 있는지 확인
- Stop Hook이 등록되어 있는지 확인 (`.claude/settings.local.json`의 `hooks.Stop`)
- Hook 파일이 빌드되어 있는지 확인: `dist/hooks/hooks/on-stop.js`

### "Slack에서 명령을 보내도 반응 없음"

- Bot 서비스가 실행 중인지 확인
- 세션 쓰레드에서 `@claude` 멘션을 사용하는지 확인
- `state/sessions/` 디렉토리에 현재 세션 폴더가 있는지 확인

### "Hook 실행 오류"

- Node.js 경로가 시스템 PATH에 있는지 확인
- mcp-slack-bridge가 빌드되어 있는지 확인: `npm run build:all`
- Hook 파일 경로가 올바른 절대 경로인지 확인

---

## 요약 체크리스트

| # | 항목 | 파일/위치 | 필수 |
|---|------|----------|------|
| 1 | Bot 서비스 실행 | mcp-slack-bridge에서 `npm run start:bot` | O |
| 2 | CLAUDE.md 생성 | 대상 프로젝트 루트 `/CLAUDE.md` | O |
| 3 | MCP 서버 등록 | `~/.claude.json` 또는 `.claude/settings.local.json` | O |
| 4 | Stop Hook 등록 | `.claude/settings.local.json` → `hooks.Stop` | O |
| 5 | PostToolUse Hook 등록 | `.claude/settings.local.json` → `hooks.PostToolUse` | O |
| 6 | 질문 전달 Hook | `.claude/settings.local.json` → `hooks.PreToolUse` | 선택 |
| 7 | 알림 Hook | `.claude/settings.local.json` → `hooks.Notification` | 선택 |
