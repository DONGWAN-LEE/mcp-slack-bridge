<!-- DO NOT DELETE: This file guides Claude Code's wait loop behavior for Slack command detection -->

## Slack 명령 대기 워크플로우

이 프로젝트는 mcp-slack-bridge를 통해 Slack @mention 명령을 수신합니다.

### 필수 규칙
1. **작업 완료 후 대기 진입**: 현재 작업이 끝나면 `slack_check_commands`를 `blocking=true`로 호출하여 Slack 명령 대기 상태로 진입하세요.
2. **명령 처리 후 재대기**: Slack 명령을 처리하고 `slack_command_result`로 결과를 보고한 후, 다시 `slack_check_commands(blocking=true)`를 호출하세요.
3. **타임아웃 시 재호출**: `slack_check_commands`가 타임아웃으로 반환되면 즉시 다시 호출하여 대기를 계속하세요.
