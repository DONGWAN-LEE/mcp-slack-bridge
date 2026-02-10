/* ===== Wizard State ===== */
const state = {
  currentStep: 1,
  totalSteps: 7,
  mode: 'fresh',
  existingEnv: {},
  defaults: {},
  config: {},
  validations: {},
};

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [statusRes, defaultsRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/defaults'),
    ]);
    const statusData = await statusRes.json();
    const defaultsData = await defaultsRes.json();

    state.mode = statusData.mode;
    state.existingEnv = statusData.existingEnv || {};
    state.defaults = defaultsData;

    if (state.mode === 'existing') {
      prefillFromExisting();
    }

    renderStep();
  } catch (err) {
    console.error('Wizard init failed:', err);
  }
});

/* ===== Prefill from existing .env ===== */
function prefillFromExisting() {
  const env = state.existingEnv;
  state.config = {
    slackBotToken: env.SLACK_BOT_TOKEN || '',
    slackAppToken: env.SLACK_APP_TOKEN || '',
    slackSigningSecret: env.SLACK_SIGNING_SECRET || '',
    slackChannelId: env.SLACK_CHANNEL_ID || '',
    allowedUserIds: (env.ALLOWED_USER_IDS || '').split(',').filter(Boolean),
    allowedChannelIds: (env.ALLOWED_CHANNEL_IDS || '').split(',').filter(Boolean),
    claudeWorkingDir: env.CLAUDE_WORKING_DIR || '',
    stateDir: env.STATE_DIR || state.defaults.stateDir,
    blockedCommands: (env.BLOCKED_COMMANDS || '').split(',').filter(Boolean),
    confirmCommands: (env.CONFIRM_COMMANDS || '').split(',').filter(Boolean),
    maxPromptLength: parseInt(env.MAX_PROMPT_LENGTH) || state.defaults.maxPromptLength,
    maxActiveSessions: parseInt(env.MAX_ACTIVE_SESSIONS) || state.defaults.maxActiveSessions,
    sessionTimeoutMs: parseInt(env.SESSION_TIMEOUT_MS) || state.defaults.sessionTimeoutMs,
    heartbeatIntervalMs: parseInt(env.HEARTBEAT_INTERVAL_MS) || state.defaults.heartbeatIntervalMs,
    staleSessionMs: parseInt(env.STALE_SESSION_MS) || state.defaults.staleSessionMs,
    notificationDelaySeconds: parseInt(env.NOTIFICATION_DELAY_SECONDS) || state.defaults.notificationDelaySeconds,
    pollIntervalMs: parseInt(env.POLL_INTERVAL_MS) || state.defaults.pollIntervalMs,
    maxConcurrentExecutions: parseInt(env.MAX_CONCURRENT_EXECUTIONS) || state.defaults.maxConcurrentExecutions,
    maxQueueSize: parseInt(env.MAX_QUEUE_SIZE) || state.defaults.maxQueueSize,
    executionTimeoutMs: parseInt(env.EXECUTION_TIMEOUT_MS) || state.defaults.executionTimeoutMs,
    logLevel: env.LOG_LEVEL || state.defaults.logLevel,
  };
}

/* ===== Rendering ===== */
function renderStep() {
  renderProgressBar();
  const card = document.getElementById('wizard-card');
  card.innerHTML = getStepContent(state.currentStep);
  attachStepHandlers(state.currentStep);
}

function renderProgressBar() {
  const bar = document.getElementById('progress-bar');
  let html = '';
  for (let i = 1; i <= state.totalSteps; i++) {
    const cls = i < state.currentStep ? 'completed' : i === state.currentStep ? 'active' : '';
    html += `<div class="step-circle ${cls}">${i < state.currentStep ? '&#10003;' : i}</div>`;
    if (i < state.totalSteps) {
      html += `<div class="step-line ${i < state.currentStep ? 'completed' : ''}"></div>`;
    }
  }
  bar.innerHTML = html;
}

/* ===== Step Content ===== */
function getStepContent(step) {
  switch (step) {
    case 1: return getStep1();
    case 2: return getStep2();
    case 3: return getStep3();
    case 4: return getStep4();
    case 5: return getStep5();
    case 6: return getStep6();
    case 7: return getStep7();
    default: return '';
  }
}

/* --- Step 1: Welcome --- */
function getStep1() {
  const isExisting = state.mode === 'existing';
  if (isExisting) {
    return `
      <h2 class="step-title">mcp-slack-bridge 설정</h2>
      <p class="step-description">기존 설정 파일(.env)이 감지되었습니다. 어떻게 하시겠습니까?</p>
      <div class="mode-selector">
        <div class="mode-option" data-action="skip">
          <h3>기존 설정 사용</h3>
          <p>현재 .env 파일을 그대로 사용하여 서비스를 시작합니다.</p>
        </div>
        <div class="mode-option" data-action="reconfigure">
          <h3>설정 변경</h3>
          <p>기존 값을 기반으로 설정을 수정합니다.</p>
        </div>
      </div>`;
  }
  return `
    <h2 class="step-title">mcp-slack-bridge 설정 마법사</h2>
    <p class="step-description">
      Slack과 Claude Code를 연동하기 위한 설정을 안내합니다.<br>
      총 7단계로 진행되며, 각 단계에서 필요한 값을 입력해주세요.
    </p>
    <div class="alert alert-warning">
      시작하기 전에 <a href="https://api.slack.com/apps" target="_blank" rel="noopener">Slack App</a>을
      먼저 생성해주세요. Bot Token, App Token, Signing Secret이 필요합니다.
    </div>
    <div class="btn-row" style="justify-content:flex-end">
      <button class="btn btn-primary" data-action="next">시작하기 &rarr;</button>
    </div>`;
}

/* --- Step 2: Slack Tokens --- */
function getStep2() {
  const c = state.config;
  return `
    <h2 class="step-title">Slack 연결 정보</h2>
    <p class="step-description">Slack App에서 발급받은 토큰 정보를 입력합니다.</p>
    <div class="form-group">
      <label for="botToken">Bot Token</label>
      <div class="help-text">OAuth & Permissions &rarr; Bot User OAuth Token (xoxb-...)</div>
      <a class="help-link" href="https://api.slack.com/apps" target="_blank" rel="noopener">어떻게 얻나요?</a>
      <input type="password" id="botToken" placeholder="xoxb-..." value="${esc(c.slackBotToken || '')}">
      <div class="validation-message" id="botToken-msg"></div>
    </div>
    <div class="form-group">
      <label for="appToken">App-Level Token</label>
      <div class="help-text">Basic Information &rarr; App-Level Tokens (xapp-...)</div>
      <a class="help-link" href="https://api.slack.com/apps" target="_blank" rel="noopener">어떻게 얻나요?</a>
      <input type="password" id="appToken" placeholder="xapp-..." value="${esc(c.slackAppToken || '')}">
      <div class="validation-message" id="appToken-msg"></div>
    </div>
    <div class="form-group">
      <label for="signingSecret">Signing Secret</label>
      <div class="help-text">Basic Information &rarr; App Credentials &rarr; Signing Secret</div>
      <input type="password" id="signingSecret" placeholder="abc123..." value="${esc(c.slackSigningSecret || '')}">
      <div class="validation-message" id="signingSecret-msg"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" data-action="prev">&larr; 이전</button>
      <button class="btn btn-primary" data-action="validate-tokens" id="btn-next" disabled>검증 후 다음 &rarr;</button>
    </div>`;
}

/* --- Step 3: Channel --- */
function getStep3() {
  const c = state.config;
  return `
    <h2 class="step-title">Slack 채널 설정</h2>
    <p class="step-description">알림을 보낼 채널의 ID를 입력합니다.</p>
    <div class="form-group">
      <label for="channelId">채널 ID</label>
      <div class="help-text">채널 우클릭 &rarr; "채널 세부정보" &rarr; 하단 ID 복사 (C로 시작)</div>
      <input type="text" id="channelId" placeholder="C0123456789" value="${esc(c.slackChannelId || '')}">
      <div class="validation-message" id="channelId-msg"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" data-action="prev">&larr; 이전</button>
      <button class="btn btn-primary" data-action="validate-channel" id="btn-next" disabled>검증 후 다음 &rarr;</button>
    </div>`;
}

/* --- Step 4: Security --- */
function getStep4() {
  const c = state.config;
  const userIds = (c.allowedUserIds || []).join(', ');
  const channelIds = (c.allowedChannelIds || []).join(', ');
  return `
    <h2 class="step-title">보안 설정</h2>
    <p class="step-description">봇을 사용할 수 있는 사용자와 채널을 제한합니다.</p>
    <div class="form-group">
      <label for="allowedUserIds">허용된 사용자 ID (필수)</label>
      <div class="help-text">Slack 프로필 &rarr; ... &rarr; "멤버 ID 복사" (U로 시작, 쉼표로 구분)</div>
      <input type="text" id="allowedUserIds" placeholder="U0123ABC, U0456DEF" value="${esc(userIds)}">
      <div class="validation-message" id="allowedUserIds-msg"></div>
    </div>
    <div class="form-group">
      <label for="allowedChannelIds">허용된 채널 ID (선택)</label>
      <div class="help-text">비워두면 모든 채널에서 사용 가능합니다. (C로 시작, 쉼표로 구분)</div>
      <input type="text" id="allowedChannelIds" placeholder="C0123456789" value="${esc(channelIds)}">
      <div class="validation-message" id="allowedChannelIds-msg"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" data-action="prev">&larr; 이전</button>
      <button class="btn btn-primary" data-action="next" id="btn-next">다음 &rarr;</button>
    </div>`;
}

/* --- Step 5: Paths --- */
function getStep5() {
  const c = state.config;
  return `
    <h2 class="step-title">경로 설정</h2>
    <p class="step-description">Claude Code 작업 디렉토리와 상태 파일 저장 경로를 설정합니다.</p>
    <div class="form-group">
      <label for="claudeWorkingDir">Claude 작업 디렉토리 (선택)</label>
      <div class="help-text">멀티세션 환경에서는 비워두세요. 각 MCP 서버가 자동 감지합니다.</div>
      <input type="text" id="claudeWorkingDir" placeholder="/path/to/your/project" value="${esc(c.claudeWorkingDir || '')}">
      <div class="validation-message" id="claudeWorkingDir-msg"></div>
    </div>
    <div class="form-group">
      <label for="stateDir">상태 파일 디렉토리</label>
      <div class="help-text">세션 상태 파일이 저장되는 경로 (기본값: ./state)</div>
      <input type="text" id="stateDir" placeholder="./state" value="${esc(c.stateDir || state.defaults.stateDir || './state')}">
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" data-action="prev">&larr; 이전</button>
      <button class="btn btn-primary" data-action="next">다음 &rarr;</button>
    </div>`;
}

/* --- Step 6: Advanced --- */
function getStep6() {
  const c = state.config;
  const d = state.defaults;
  return `
    <h2 class="step-title">고급 설정</h2>
    <p class="step-description">대부분의 경우 기본값을 유지하면 됩니다.</p>

    <div class="collapsible-header" data-toggle="security-filters">
      <h3>보안 필터</h3>
      <span class="collapsible-arrow">&#9660;</span>
    </div>
    <div class="collapsible-content" id="security-filters">
      <div class="form-group">
        <label for="blockedCommands">차단 명령어 (쉼표 구분)</label>
        <input type="text" id="blockedCommands" value="${esc((c.blockedCommands || d.blockedCommands || []).join(','))}">
      </div>
      <div class="form-group">
        <label for="confirmCommands">확인 필요 명령어 (쉼표 구분)</label>
        <input type="text" id="confirmCommands" value="${esc((c.confirmCommands || d.confirmCommands || []).join(','))}">
      </div>
      <div class="form-group">
        <label for="maxPromptLength">최대 프롬프트 길이</label>
        <input type="number" id="maxPromptLength" value="${c.maxPromptLength || d.maxPromptLength || 2000}" min="100" max="10000">
      </div>
    </div>

    <div class="collapsible-header" data-toggle="session-settings">
      <h3>세션 관리</h3>
      <span class="collapsible-arrow">&#9660;</span>
    </div>
    <div class="collapsible-content" id="session-settings">
      <div class="form-group">
        <label for="maxActiveSessions">최대 활성 세션 수</label>
        <input type="number" id="maxActiveSessions" value="${c.maxActiveSessions || d.maxActiveSessions || 10}" min="1" max="50">
      </div>
      <div class="form-group">
        <label for="sessionTimeoutMs">세션 타임아웃 (ms)</label>
        <input type="number" id="sessionTimeoutMs" value="${c.sessionTimeoutMs || d.sessionTimeoutMs || 3600000}" min="60000">
      </div>
      <div class="form-group">
        <label for="heartbeatIntervalMs">하트비트 간격 (ms)</label>
        <input type="number" id="heartbeatIntervalMs" value="${c.heartbeatIntervalMs || d.heartbeatIntervalMs || 30000}" min="5000">
      </div>
      <div class="form-group">
        <label for="staleSessionMs">유휴 세션 정리 (ms)</label>
        <input type="number" id="staleSessionMs" value="${c.staleSessionMs || d.staleSessionMs || 300000}" min="60000">
      </div>
    </div>

    <div class="collapsible-header" data-toggle="polling-settings">
      <h3>폴링 및 큐</h3>
      <span class="collapsible-arrow">&#9660;</span>
    </div>
    <div class="collapsible-content" id="polling-settings">
      <div class="form-group">
        <label for="notificationDelaySeconds">알림 지연 시간 (초)</label>
        <div class="help-text">로컬에서 먼저 응답하면 Slack 알림을 보내지 않습니다.</div>
        <input type="number" id="notificationDelaySeconds" value="${c.notificationDelaySeconds ?? d.notificationDelaySeconds ?? 300}" min="0">
      </div>
      <div class="form-group">
        <label for="pollIntervalMs">폴링 간격 (ms)</label>
        <input type="number" id="pollIntervalMs" value="${c.pollIntervalMs || d.pollIntervalMs || 2000}" min="500">
      </div>
      <div class="form-group">
        <label for="maxConcurrentExecutions">최대 동시 실행 수</label>
        <input type="number" id="maxConcurrentExecutions" value="${c.maxConcurrentExecutions || d.maxConcurrentExecutions || 1}" min="1" max="10">
      </div>
      <div class="form-group">
        <label for="maxQueueSize">최대 큐 크기</label>
        <input type="number" id="maxQueueSize" value="${c.maxQueueSize || d.maxQueueSize || 5}" min="1" max="50">
      </div>
      <div class="form-group">
        <label for="executionTimeoutMs">실행 타임아웃 (ms)</label>
        <input type="number" id="executionTimeoutMs" value="${c.executionTimeoutMs || d.executionTimeoutMs || 600000}" min="30000">
      </div>
    </div>

    <div class="form-group" style="margin-top:20px">
      <label for="logLevel">로그 레벨</label>
      <select id="logLevel">
        <option value="debug" ${(c.logLevel || d.logLevel) === 'debug' ? 'selected' : ''}>debug</option>
        <option value="info" ${(c.logLevel || d.logLevel || 'info') === 'info' ? 'selected' : ''}>info</option>
        <option value="warn" ${(c.logLevel || d.logLevel) === 'warn' ? 'selected' : ''}>warn</option>
        <option value="error" ${(c.logLevel || d.logLevel) === 'error' ? 'selected' : ''}>error</option>
      </select>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" data-action="prev">&larr; 이전</button>
      <button class="btn btn-primary" data-action="next">검토하기 &rarr;</button>
    </div>`;
}

/* --- Step 7: Review & Apply --- */
function getStep7() {
  collectAllConfig();
  const c = state.config;
  const maskToken = (t) => t ? t.slice(0, 8) + '...' + t.slice(-4) : '-';
  return `
    <h2 class="step-title">설정 검토</h2>
    <p class="step-description">아래 설정을 확인 후 적용 버튼을 클릭하세요.</p>

    <div class="summary-section">
      <h3>Slack 연결</h3>
      <table class="summary-table">
        <tr><td>Bot Token</td><td class="masked">${esc(maskToken(c.slackBotToken))}</td></tr>
        <tr><td>App Token</td><td class="masked">${esc(maskToken(c.slackAppToken))}</td></tr>
        <tr><td>Signing Secret</td><td class="masked">${esc(maskToken(c.slackSigningSecret))}</td></tr>
        <tr><td>채널 ID</td><td>${esc(c.slackChannelId)}</td></tr>
      </table>
    </div>

    <div class="summary-section">
      <h3>보안</h3>
      <table class="summary-table">
        <tr><td>허용 사용자</td><td>${esc((c.allowedUserIds || []).join(', '))}</td></tr>
        <tr><td>허용 채널</td><td>${esc((c.allowedChannelIds || []).join(', ') || '전체 허용')}</td></tr>
      </table>
    </div>

    <div class="summary-section">
      <h3>경로</h3>
      <table class="summary-table">
        <tr><td>작업 디렉토리</td><td>${esc(c.claudeWorkingDir || '자동 감지')}</td></tr>
        <tr><td>상태 디렉토리</td><td>${esc(c.stateDir)}</td></tr>
      </table>
    </div>

    <div class="summary-section">
      <h3>고급 설정</h3>
      <table class="summary-table">
        <tr><td>로그 레벨</td><td>${esc(c.logLevel)}</td></tr>
        <tr><td>최대 활성 세션</td><td>${c.maxActiveSessions}</td></tr>
        <tr><td>폴링 간격</td><td>${c.pollIntervalMs}ms</td></tr>
        <tr><td>알림 지연</td><td>${c.notificationDelaySeconds}초</td></tr>
      </table>
    </div>

    <div class="alert alert-warning">
      적용 시 <code>.env</code> 파일과 <code>.claude/settings.local.json</code> 파일이 생성/업데이트됩니다.
      기존 .env 파일은 자동 백업됩니다.
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" data-action="prev">&larr; 수정하기</button>
      <button class="btn btn-success" data-action="apply" id="btn-apply">설정 적용</button>
    </div>`;
}

/* ===== Event Handlers ===== */
function attachStepHandlers(step) {
  // Navigation buttons
  document.querySelectorAll('[data-action="next"]').forEach(btn => {
    btn.addEventListener('click', () => goNext());
  });
  document.querySelectorAll('[data-action="prev"]').forEach(btn => {
    btn.addEventListener('click', () => goPrev());
  });

  // Step-specific handlers
  switch (step) {
    case 1:
      document.querySelectorAll('.mode-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const action = opt.dataset.action;
          if (action === 'skip') {
            skipWizard();
          } else {
            goNext();
          }
        });
      });
      break;

    case 2:
      setupTokenValidation();
      break;

    case 3:
      setupChannelValidation();
      break;

    case 4:
      setupUserIdValidation();
      break;

    case 6:
      setupCollapsibles();
      break;

    case 7:
      const applyBtn = document.querySelector('[data-action="apply"]');
      if (applyBtn) applyBtn.addEventListener('click', applyConfig);
      break;
  }
}

/* ===== Navigation ===== */
function goNext() {
  collectStepConfig(state.currentStep);
  if (state.currentStep < state.totalSteps) {
    state.currentStep++;
    renderStep();
  }
}

function goPrev() {
  collectStepConfig(state.currentStep);
  if (state.currentStep > 1) {
    state.currentStep--;
    renderStep();
  }
}

/* ===== Collect Config from Current Step ===== */
function collectStepConfig(step) {
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const c = state.config;

  switch (step) {
    case 2:
      c.slackBotToken = val('botToken');
      c.slackAppToken = val('appToken');
      c.slackSigningSecret = val('signingSecret');
      break;
    case 3:
      c.slackChannelId = val('channelId');
      break;
    case 4:
      c.allowedUserIds = val('allowedUserIds').split(',').map(s => s.trim()).filter(Boolean);
      c.allowedChannelIds = val('allowedChannelIds').split(',').map(s => s.trim()).filter(Boolean);
      break;
    case 5:
      c.claudeWorkingDir = val('claudeWorkingDir') || undefined;
      c.stateDir = val('stateDir') || state.defaults.stateDir;
      break;
    case 6:
      c.blockedCommands = val('blockedCommands').split(',').map(s => s.trim()).filter(Boolean);
      c.confirmCommands = val('confirmCommands').split(',').map(s => s.trim()).filter(Boolean);
      c.maxPromptLength = parseInt(val('maxPromptLength')) || state.defaults.maxPromptLength;
      c.maxActiveSessions = parseInt(val('maxActiveSessions')) || state.defaults.maxActiveSessions;
      c.sessionTimeoutMs = parseInt(val('sessionTimeoutMs')) || state.defaults.sessionTimeoutMs;
      c.heartbeatIntervalMs = parseInt(val('heartbeatIntervalMs')) || state.defaults.heartbeatIntervalMs;
      c.staleSessionMs = parseInt(val('staleSessionMs')) || state.defaults.staleSessionMs;
      const parsedDelay = parseInt(val('notificationDelaySeconds'));
      c.notificationDelaySeconds = Number.isNaN(parsedDelay) ? state.defaults.notificationDelaySeconds : parsedDelay;
      c.pollIntervalMs = parseInt(val('pollIntervalMs')) || state.defaults.pollIntervalMs;
      c.maxConcurrentExecutions = parseInt(val('maxConcurrentExecutions')) || state.defaults.maxConcurrentExecutions;
      c.maxQueueSize = parseInt(val('maxQueueSize')) || state.defaults.maxQueueSize;
      c.executionTimeoutMs = parseInt(val('executionTimeoutMs')) || state.defaults.executionTimeoutMs;
      c.logLevel = val('logLevel') || state.defaults.logLevel;
      break;
  }
}

function collectAllConfig() {
  // Make sure we have defaults for anything not set
  const d = state.defaults;
  const c = state.config;
  c.stateDir = c.stateDir || d.stateDir;
  c.blockedCommands = c.blockedCommands || d.blockedCommands;
  c.confirmCommands = c.confirmCommands || d.confirmCommands;
  c.maxPromptLength = c.maxPromptLength || d.maxPromptLength;
  c.maxActiveSessions = c.maxActiveSessions || d.maxActiveSessions;
  c.sessionTimeoutMs = c.sessionTimeoutMs || d.sessionTimeoutMs;
  c.heartbeatIntervalMs = c.heartbeatIntervalMs || d.heartbeatIntervalMs;
  c.staleSessionMs = c.staleSessionMs || d.staleSessionMs;
  c.notificationDelaySeconds = c.notificationDelaySeconds ?? d.notificationDelaySeconds;
  c.pollIntervalMs = c.pollIntervalMs || d.pollIntervalMs;
  c.maxConcurrentExecutions = c.maxConcurrentExecutions || d.maxConcurrentExecutions;
  c.maxQueueSize = c.maxQueueSize || d.maxQueueSize;
  c.executionTimeoutMs = c.executionTimeoutMs || d.executionTimeoutMs;
  c.logLevel = c.logLevel || d.logLevel;
}

/* ===== Validation Helpers ===== */
let validateDebounce = null;

function setValidation(fieldId, status, message) {
  const input = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + '-msg');
  if (input) {
    input.classList.remove('is-valid', 'is-invalid');
    if (status === 'success') input.classList.add('is-valid');
    else if (status === 'error') input.classList.add('is-invalid');
  }
  if (msgEl) {
    msgEl.className = 'validation-message ' + status;
    msgEl.textContent = message;
  }
}

function setupTokenValidation() {
  const fields = ['botToken', 'appToken', 'signingSecret'];
  const btnNext = document.getElementById('btn-next');

  function checkCanProceed() {
    const bot = document.getElementById('botToken');
    const app = document.getElementById('appToken');
    const secret = document.getElementById('signingSecret');
    const allFilled = bot?.value.trim() && app?.value.trim() && secret?.value.trim();
    if (btnNext) btnNext.disabled = !allFilled;
  }

  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      checkCanProceed();
    });
  });

  if (btnNext) {
    btnNext.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btnNext.disabled = true;
      btnNext.innerHTML = '<span class="spinner"></span> 검증 중...';

      const botToken = document.getElementById('botToken').value.trim();
      const appToken = document.getElementById('appToken').value.trim();
      const signingSecret = document.getElementById('signingSecret').value.trim();

      try {
        const res = await fetch('/api/validate/slack-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botToken, appToken, signingSecret }),
        });
        const data = await res.json();

        let allValid = true;

        if (data.botToken) {
          if (data.botToken.valid) {
            setValidation('botToken', 'success', `Team: ${data.botToken.details?.team || ''}`);
          } else {
            setValidation('botToken', 'error', data.botToken.error);
            allValid = false;
          }
        }

        if (data.appToken) {
          if (data.appToken.valid) {
            setValidation('appToken', 'success', '형식 확인 완료');
          } else {
            setValidation('appToken', 'error', data.appToken.error);
            allValid = false;
          }
        }

        if (data.signingSecret) {
          if (data.signingSecret.valid) {
            setValidation('signingSecret', 'success', '형식 확인 완료');
          } else {
            setValidation('signingSecret', 'error', data.signingSecret.error);
            allValid = false;
          }
        }

        if (allValid) {
          state.config.slackBotToken = botToken;
          state.config.slackAppToken = appToken;
          state.config.slackSigningSecret = signingSecret;
          state.currentStep++;
          renderStep();
        } else {
          btnNext.disabled = false;
          btnNext.innerHTML = '검증 후 다음 &rarr;';
        }
      } catch {
        setValidation('botToken', 'error', 'API 연결 실패. 네트워크를 확인해주세요.');
        btnNext.disabled = false;
        btnNext.innerHTML = '검증 후 다음 &rarr;';
      }
    });
  }

  checkCanProceed();
}

function setupChannelValidation() {
  const btnNext = document.getElementById('btn-next');
  const channelInput = document.getElementById('channelId');

  if (channelInput) {
    channelInput.addEventListener('input', () => {
      if (btnNext) btnNext.disabled = !channelInput.value.trim();
    });
    if (channelInput.value.trim() && btnNext) btnNext.disabled = false;
  }

  if (btnNext) {
    btnNext.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btnNext.disabled = true;
      btnNext.innerHTML = '<span class="spinner"></span> 검증 중...';

      const channelId = channelInput.value.trim();

      try {
        const res = await fetch('/api/validate/channel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId }),
        });
        const data = await res.json();

        if (data.valid) {
          setValidation('channelId', 'success', `채널: #${data.details?.channelName || channelId}`);
          state.config.slackChannelId = channelId;
          state.currentStep++;
          renderStep();
        } else {
          setValidation('channelId', 'error', data.error);
          btnNext.disabled = false;
          btnNext.innerHTML = '검증 후 다음 &rarr;';
        }
      } catch {
        setValidation('channelId', 'error', 'API 연결 실패');
        btnNext.disabled = false;
        btnNext.innerHTML = '검증 후 다음 &rarr;';
      }
    });
  }
}

function setupUserIdValidation() {
  const input = document.getElementById('allowedUserIds');
  const btnNext = document.getElementById('btn-next');

  function validate() {
    const val = input?.value.trim() || '';
    if (!val) {
      if (btnNext) btnNext.disabled = true;
      return;
    }
    const ids = val.split(',').map(s => s.trim()).filter(Boolean);
    const invalid = ids.filter(id => !/^U[A-Z0-9]{8,}$/.test(id));
    if (invalid.length > 0) {
      setValidation('allowedUserIds', 'error', `올바르지 않은 ID: ${invalid.join(', ')}`);
      if (btnNext) btnNext.disabled = true;
    } else {
      setValidation('allowedUserIds', 'success', `${ids.length}명 확인`);
      if (btnNext) btnNext.disabled = false;
    }
  }

  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(validateDebounce);
      validateDebounce = setTimeout(validate, 300);
    });
    validate();
  }
}

function setupCollapsibles() {
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      const targetId = header.dataset.toggle;
      const content = document.getElementById(targetId);
      const arrow = header.querySelector('.collapsible-arrow');
      if (content) content.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
    });
  });
}

/* ===== Apply Config ===== */
async function applyConfig() {
  const btn = document.getElementById('btn-apply');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 적용 중...';
  }

  collectAllConfig();

  try {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.config),
    });
    const data = await res.json();

    if (data.success) {
      showCompletion();
    } else {
      showError(data.error || '설정 적용에 실패했습니다.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '설정 적용';
      }
    }
  } catch {
    showError('서버 연결 실패. 다시 시도해주세요.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '설정 적용';
    }
  }
}

/* ===== Skip Wizard ===== */
async function skipWizard() {
  try {
    await fetch('/api/skip', { method: 'POST' });
    const card = document.getElementById('wizard-card');
    card.innerHTML = `
      <div class="completion-screen">
        <div class="completion-icon">&#9889;</div>
        <h2>기존 설정으로 시작합니다</h2>
        <p>이 창을 닫아도 됩니다. 서비스가 자동으로 시작됩니다.</p>
      </div>`;
  } catch {
    showError('스킵 요청 실패');
  }
}

/* ===== Completion Screen ===== */
function showCompletion() {
  const card = document.getElementById('wizard-card');
  card.innerHTML = `
    <div class="completion-screen">
      <div class="completion-icon">&#10004;&#65039;</div>
      <h2>설정이 완료되었습니다!</h2>
      <p>다음 파일이 생성되었습니다:</p>
      <p><code>.env</code> &mdash; 환경변수 설정</p>
      <p><code>.claude/settings.local.json</code> &mdash; Claude Code 설정</p>
      <br>
      <p>이 창을 닫아도 됩니다. Bot 서비스가 자동으로 시작됩니다.</p>
    </div>`;
  document.getElementById('progress-bar').innerHTML = '';
}

function showError(msg) {
  const card = document.getElementById('wizard-card');
  const existing = card.querySelector('.alert-danger');
  if (existing) existing.remove();
  const alert = document.createElement('div');
  alert.className = 'alert alert-danger';
  alert.textContent = msg;
  card.prepend(alert);
}

/* ===== Utility ===== */
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
