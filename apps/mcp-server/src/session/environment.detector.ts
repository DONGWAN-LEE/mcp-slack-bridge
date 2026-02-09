import { Injectable } from '@nestjs/common';
import { EnvironmentInfo } from '@app/shared/types/session.types';

@Injectable()
export class EnvironmentDetector {
  detect(): EnvironmentInfo {
    const terminal = this.detectTerminal();
    const shell = this.detectShell();
    const pid = process.pid;
    const displayName = this.buildDisplayName(terminal, pid);

    return { terminal, pid, shell, displayName };
  }

  private detectTerminal(): EnvironmentInfo['terminal'] {
    const env = process.env;

    // VS Code
    if (env.VSCODE_PID || env.TERM_PROGRAM === 'vscode') {
      return 'vscode';
    }

    // Warp
    if (env.TERM_PROGRAM === 'WarpTerminal') {
      return 'warp';
    }

    // iTerm
    if (env.TERM_PROGRAM === 'iTerm.app') {
      return 'iterm';
    }

    // Windows Terminal
    if (env.WT_SESSION) {
      return 'windows-terminal';
    }

    // PowerShell (Windows: PSModulePath exists but not classic CMD PROMPT)
    if (env.PSModulePath && !env.PROMPT) {
      return 'powershell';
    }

    // CMD fallback on Windows
    if (process.platform === 'win32') {
      return 'cmd';
    }

    return 'unknown';
  }

  private detectShell(): EnvironmentInfo['shell'] {
    const shellEnv = process.env.SHELL || process.env.ComSpec || '';
    const lower = shellEnv.toLowerCase();

    if (lower.includes('pwsh') || lower.includes('powershell')) {
      return 'powershell';
    }
    if (lower.includes('bash')) {
      return 'bash';
    }
    if (lower.includes('zsh')) {
      return 'zsh';
    }
    if (lower.includes('cmd')) {
      return 'cmd';
    }

    // PSModulePath fallback — exists on most Windows systems
    if (process.env.PSModulePath && !process.env.PROMPT) {
      return 'powershell';
    }

    return 'unknown';
  }

  private buildDisplayName(
    terminal: EnvironmentInfo['terminal'],
    pid: number,
  ): string {
    const names: Record<EnvironmentInfo['terminal'], string> = {
      vscode: 'VS Code',
      warp: 'Warp',
      iterm: 'iTerm',
      'windows-terminal': 'Windows Terminal',
      powershell: 'PowerShell',
      cmd: 'CMD',
      unknown: 'Terminal',
    };

    const name = names[terminal];

    if (terminal === 'vscode') {
      const vscodePid = process.env.VSCODE_PID || pid;
      return `${name} (PID ${vscodePid})`;
    }

    if (terminal === 'windows-terminal') {
      const wtSession = process.env.WT_SESSION || '';
      const shortId = wtSession.substring(0, 8);
      return `${name} (${shortId})`;
    }

    return name;
  }
}
