import { EnvironmentDetector } from './environment.detector';

describe('EnvironmentDetector', () => {
  let detector: EnvironmentDetector;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    detector = new EnvironmentDetector();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function clearTerminalEnvVars() {
    delete process.env.VSCODE_PID;
    delete process.env.TERM_PROGRAM;
    delete process.env.WT_SESSION;
    delete process.env.PSModulePath;
    delete process.env.PROMPT;
    delete process.env.SHELL;
    delete process.env.ComSpec;
  }

  describe('terminal detection', () => {
    it('should detect VS Code via VSCODE_PID', () => {
      clearTerminalEnvVars();
      process.env.VSCODE_PID = '12345';

      const result = detector.detect();
      expect(result.terminal).toBe('vscode');
      expect(result.displayName).toBe('VS Code (PID 12345)');
    });

    it('should detect VS Code via TERM_PROGRAM', () => {
      clearTerminalEnvVars();
      process.env.TERM_PROGRAM = 'vscode';

      const result = detector.detect();
      expect(result.terminal).toBe('vscode');
    });

    it('should detect Warp terminal', () => {
      clearTerminalEnvVars();
      process.env.TERM_PROGRAM = 'WarpTerminal';

      const result = detector.detect();
      expect(result.terminal).toBe('warp');
      expect(result.displayName).toBe('Warp');
    });

    it('should detect iTerm', () => {
      clearTerminalEnvVars();
      process.env.TERM_PROGRAM = 'iTerm.app';

      const result = detector.detect();
      expect(result.terminal).toBe('iterm');
      expect(result.displayName).toBe('iTerm');
    });

    it('should detect Windows Terminal via WT_SESSION', () => {
      clearTerminalEnvVars();
      process.env.WT_SESSION = 'abc12345-6789-0000-1111-222233334444';

      const result = detector.detect();
      expect(result.terminal).toBe('windows-terminal');
      expect(result.displayName).toBe('Windows Terminal (abc12345)');
    });

    it('should detect PowerShell', () => {
      clearTerminalEnvVars();
      process.env.PSModulePath = 'C:\\Program Files\\PowerShell\\Modules';
      // No PROMPT means not CMD

      const result = detector.detect();
      expect(result.terminal).toBe('powershell');
      expect(result.displayName).toBe('PowerShell');
    });

    it('should fallback to unknown when no env vars match on non-win32', () => {
      clearTerminalEnvVars();
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = detector.detect();
      expect(result.terminal).toBe('unknown');
      expect(result.displayName).toBe('Terminal');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('shell detection', () => {
    it('should detect bash from SHELL env', () => {
      clearTerminalEnvVars();
      process.env.SHELL = '/bin/bash';

      const result = detector.detect();
      expect(result.shell).toBe('bash');
    });

    it('should detect zsh from SHELL env', () => {
      clearTerminalEnvVars();
      process.env.SHELL = '/bin/zsh';

      const result = detector.detect();
      expect(result.shell).toBe('zsh');
    });

    it('should detect powershell from PSModulePath fallback', () => {
      clearTerminalEnvVars();
      process.env.PSModulePath = 'C:\\something';
      // No SHELL, ComSpec, or PROMPT — PSModulePath is the fallback

      const result = detector.detect();
      expect(result.shell).toBe('powershell');
    });

    it('should prefer SHELL over PSModulePath', () => {
      clearTerminalEnvVars();
      process.env.SHELL = '/bin/bash';
      process.env.PSModulePath = 'C:\\something';

      const result = detector.detect();
      expect(result.shell).toBe('bash');
    });

    it('should detect cmd from ComSpec', () => {
      clearTerminalEnvVars();
      process.env.ComSpec = 'C:\\Windows\\system32\\cmd.exe';

      const result = detector.detect();
      expect(result.shell).toBe('cmd');
    });

    it('should return unknown when no shell env vars', () => {
      clearTerminalEnvVars();
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = detector.detect();
      expect(result.shell).toBe('unknown');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('common fields', () => {
    it('should include current process pid', () => {
      const result = detector.detect();
      expect(result.pid).toBe(process.pid);
    });
  });
});
