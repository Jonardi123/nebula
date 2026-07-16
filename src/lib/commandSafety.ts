import type { RiskLevel } from '../types/tools'

export interface SafetyResult {
  level: RiskLevel
  reason: string
  requiresTypedConfirm: boolean
}

const safeCommands = [/^\s*dir\b/i, /^\s*echo\b/i, /^\s*npm\s+test\b/i, /^\s*npm\s+run\s+build\b/i, /^\s*git\s+status\b/i]

const approvalCommands = [
  /^\s*npm\s+install\b/i,
  /^\s*pnpm\s+install\b/i,
  /^\s*yarn\s+add\b/i,
  /^\s*pip\s+install\b/i,
  /^\s*python\s+-m\s+pip\s+install\b/i,
  /^\s*start\b/i,
  /^\s*shutdown\b/i,
]

const highRiskCommands = [
  /\bdel\b/i,
  /\berase\b/i,
  /\brmdir\b/i,
  /\brm\s+-/i,
  /\bRemove-Item\b/i,
  /\breg\s+(add|delete|import)\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bsc\s+(stop|delete|config)\b/i,
  /\bnetsh\b/i,
]

const blockedCommands = [
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\bclean\b.*\bdiskpart\b/i,
  /\bdel\s+.*C:\\Windows/i,
  /\brmdir\s+\/s\s+C:\\/i,
  /\bRemove-Item\s+.*C:\\Windows/i,
  /\bSet-MpPreference\b.*Disable/i,
  /\bDisableRealtimeMonitoring\b/i,
  /\bmimikatz\b/i,
  /\blsass\b/i,
  /\bprocdump\b.*lsass/i,
  /\bGet-Credential\b/i,
  /\bnet\s+user\b.*\*/i,
  /\bInvoke-WebRequest\b.*\|\s*(iex|Invoke-Expression)/i,
  /\bcurl\b.*\|\s*(sh|powershell|pwsh|cmd)/i,
]

export function classifyCommand(command: string): SafetyResult {
  if (blockedCommands.some((pattern) => pattern.test(command))) {
    return {
      level: 'blocked',
      reason: 'This command matches a blocked destructive or credential-related pattern.',
      requiresTypedConfirm: false,
    }
  }

  if (highRiskCommands.some((pattern) => pattern.test(command))) {
    return {
      level: 'high_risk',
      reason: 'This command can delete files, modify the registry, or change system behavior.',
      requiresTypedConfirm: true,
    }
  }

  if (safeCommands.some((pattern) => pattern.test(command))) {
    return {
      level: 'safe',
      reason: 'This command is read-only or project-local build/test status work.',
      requiresTypedConfirm: false,
    }
  }

  if (approvalCommands.some((pattern) => pattern.test(command))) {
    return {
      level: 'needs_approval',
      reason: 'This command installs packages, starts apps, or changes machine state.',
      requiresTypedConfirm: false,
    }
  }

  return {
    level: 'needs_approval',
    reason: 'Unknown commands require user approval before execution.',
    requiresTypedConfirm: false,
  }
}

export function classifyTool(tool: string, args: Record<string, unknown>): SafetyResult {
  if (tool === 'web_search') {
    return {
      level: 'safe',
      reason: 'Web search uses the configured provider interface and returns links/snippets only.',
      requiresTypedConfirm: false,
    }
  }

  if (tool === 'web_fetch') {
    const url = String(args.url ?? '')
    if (isBlockedWebUrl(url)) {
      return {
        level: 'blocked',
        reason: 'Private/local, non-http(s), credentialed, or downloadable URLs are blocked.',
        requiresTypedConfirm: false,
      }
    }

    if (isSuspiciousWebUrl(url)) {
      return {
        level: 'needs_approval',
        reason: 'This URL has suspicious query/path characteristics and should be reviewed before fetching.',
        requiresTypedConfirm: false,
      }
    }

    return {
      level: 'safe',
      reason: 'Public text webpage fetch.',
      requiresTypedConfirm: false,
    }
  }

  if (tool === 'run_command') {
    return classifyCommand(String(args.command ?? ''))
  }

  if (tool === 'capture_screen') {
    return {
      level: 'needs_approval',
      reason: 'Screen capture can include private information on the desktop.',
      requiresTypedConfirm: false,
    }
  }

  if (['write_file', 'create_file', 'append_file', 'sleep_pc'].includes(tool)) {
    return {
      level: 'needs_approval',
      reason: `${tool} changes files or system power state and requires approval.`,
      requiresTypedConfirm: false,
    }
  }

  if (tool === 'open_app') {
    const appName = String(args.app ?? args.path ?? '').toLowerCase()
    const known = ['notepad', 'calculator', 'calc', 'cmd', 'powershell', 'explorer']
    return known.includes(appName)
      ? { level: 'needs_approval', reason: 'Opening an app changes desktop state.', requiresTypedConfirm: false }
      : {
          level: 'high_risk',
          reason: 'Unknown app paths require explicit confirmation.',
          requiresTypedConfirm: true,
        }
  }

  return { level: 'safe', reason: 'Read-only tool.', requiresTypedConfirm: false }
}

function isBlockedWebUrl(url: string) {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(parsed.protocol)) return true
    if (parsed.username || parsed.password) return true
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true
    if (hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1') return true
    if (/^10\./.test(hostname)) return true
    if (/^192\.168\./.test(hostname)) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true
    if (/^169\.254\./.test(hostname)) return true
    if (/\.(exe|msi|bat|cmd|ps1|zip|7z|rar|tar|gz|dmg|pkg)$/i.test(parsed.pathname)) return true
    return false
  } catch {
    return true
  }
}

function isSuspiciousWebUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.search.length > 180 || /\b(download|installer|setup|payload|token|auth|redirect)\b/i.test(url)
  } catch {
    return true
  }
}
