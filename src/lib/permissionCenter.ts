import type { PermissionCapability } from '../types/nebula'
import type { AppSettings } from '../types/settings'

type BooleanSettingKey = {
  [Key in keyof AppSettings]: AppSettings[Key] extends boolean ? Key : never
}[keyof AppSettings]

interface CapabilityDefinition {
  id: string
  label: string
  description: string
  category: PermissionCapability['category']
  riskLevel: PermissionCapability['riskLevel']
  settingKeys: BooleanSettingKey[]
  usedBy: string[]
  locked?: boolean
  lockedReason?: string
}

const definitions: CapabilityDefinition[] = [
  {
    id: 'files',
    label: 'Files',
    description: 'Read project files and show workspace context.',
    category: 'workspace',
    riskLevel: 'safe',
    settingKeys: ['contextInjectionEnabled'],
    usedBy: ['File Explorer', 'Context Engine', 'Project Profiles'],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Allow safe command planning and safe command routines.',
    category: 'automation',
    riskLevel: 'needs_confirmation',
    settingKeys: ['riskyToolsEnabled'],
    usedBy: ['Terminal Skill', 'Fix My App', 'Automation Routines'],
  },
  {
    id: 'web',
    label: 'Web',
    description: 'Use automatic web search and safe webpage fetches.',
    category: 'web',
    riskLevel: 'safe',
    settingKeys: ['autoWebSearch'],
    usedBy: ['Web Search Skill', 'Research Workflow', 'Source Cards'],
  },
  {
    id: 'apps',
    label: 'Known App Launch',
    description: 'Open known safe apps such as Explorer, Notepad, Calculator, and shells.',
    category: 'desktop',
    riskLevel: 'needs_confirmation',
    settingKeys: ['desktopControlBetaEnabled'],
    usedBy: ['Desktop Control Beta', 'Routine Templates', 'Launcher'],
  },
  {
    id: 'microphone',
    label: 'Microphone',
    description: 'Use browser speech recognition in the ambient assistant.',
    category: 'voice',
    riskLevel: 'safe',
    settingKeys: ['voiceEnabled'],
    usedBy: ['Ambient Assistant', 'Voice Mode'],
  },
  {
    id: 'screenshot',
    label: 'Screenshot Context',
    description: 'Capture screen context for Screenshot Ask Mode.',
    category: 'voice',
    riskLevel: 'safe',
    settingKeys: ['screenAwarenessEnabled', 'screenshotAskEnabled'],
    usedBy: ['Ambient Assistant', 'Screenshot Ask'],
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Read and write useful local memory notes.',
    category: 'core',
    riskLevel: 'safe',
    settingKeys: [],
    usedBy: ['Unified Memory', 'Memory Core', 'Memory Inbox'],
    locked: true,
    lockedReason: 'Memory Core is part of Nebula local-first operation.',
  },
  {
    id: 'scheduler',
    label: 'Automation Scheduler',
    description: 'Run enabled routines on startup, project open, intervals, and LM Studio state changes.',
    category: 'automation',
    riskLevel: 'safe',
    settingKeys: ['automationSchedulerEnabled'],
    usedBy: ['Nebula Core', 'Routine Templates'],
  },
  {
    id: 'desktop_beta',
    label: 'Desktop Control Beta',
    description: 'Enables safe local desktop integration points. Destructive actions remain blocked.',
    category: 'desktop',
    riskLevel: 'needs_confirmation',
    settingKeys: ['desktopControlBetaEnabled'],
    usedBy: ['Known App Launch', 'Browser Beta placeholders'],
  },
]

export function getPermissionCapabilities(settings: AppSettings): PermissionCapability[] {
  return definitions.map((definition) => {
    const override = settings.permissionCenterOverrides?.[definition.id]
    const settingsEnabled =
      definition.settingKeys.length === 0 ||
      definition.settingKeys.every((key) => Boolean(settings[key]))
    const enabled = definition.locked ? true : override ? override === 'enabled' : settingsEnabled

    return {
      ...definition,
      enabled,
      settingKeys: definition.settingKeys.map(String),
    }
  })
}

export function setPermissionCapability(settings: AppSettings, id: string, enabled: boolean): AppSettings {
  const definition = definitions.find((item) => item.id === id)
  if (!definition || definition.locked) return settings
  const booleanUpdates = Object.fromEntries(definition.settingKeys.map((key) => [key, enabled]))
  return {
    ...settings,
    ...booleanUpdates,
    permissionCenterOverrides: {
      ...(settings.permissionCenterOverrides ?? {}),
      [id]: enabled ? 'enabled' : 'disabled',
    },
  }
}
