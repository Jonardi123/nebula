import { coreAgentSkills } from './coreAgentSkills'
import { fileSkill } from './fileSkill'
import { memorySkill } from './memorySkill'
import { pcControlSkill } from './pcControlSkill'
import { screenSkill } from './screenSkill'
import { terminalSkill } from './terminalSkill'
import { getInstalledMarketplaceSkills } from './marketplace'
import { getBuiltSkillDefinitions, setSkillDraftEnabled } from '../lib/skillBuilder'
import type { OpenAIToolDefinition, SkillDefinition } from './types'
import {
  getExecutableSkillTools,
  getExecutableToolNames,
  normalizeSkill,
  normalizeSkills,
  selectSkillsForRequest,
  getSkillRuntimeStat,
  getSkillRuntimeStats,
  recordSkillExecution,
  findSkillForTool,
} from './registry'
import { webCallSkill } from './webCallSkill'
import { webSearchSkill } from './webSearchSkill'

const SKILL_STATE_KEY = 'nebula-skill-state'

export const INSTALLED_SKILLS: SkillDefinition[] = [
  ...coreAgentSkills,
  memorySkill,
  fileSkill,
  terminalSkill,
  webSearchSkill,
  webCallSkill,
  screenSkill,
  pcControlSkill,
]

export function loadSkillState(): Record<string, boolean> {
  const defaults = Object.fromEntries(getAllKnownSkills().map((skill) => [skill.id, skill.enabled]))

  try {
    const raw = localStorage.getItem(SKILL_STATE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
    const sanitized = Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[0] === 'string' && typeof entry[1] === 'boolean'),
    )
    return { ...defaults, ...sanitized }
  } catch {
    return defaults
  }
}

export function saveSkillState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(SKILL_STATE_KEY, JSON.stringify(state))
  } catch {
    // Skill state is recoverable; do not let storage quota/security failures crash Nebula.
  }
}

export function setSkillEnabled(skillId: string, enabled: boolean) {
  if (skillId.startsWith('builder:')) {
    setSkillDraftEnabled(skillId.replace(/^builder:/, ''), enabled)
    return loadSkillState()
  }
  const state = loadSkillState()
  const next = { ...state, [skillId]: enabled }
  saveSkillState(next)
  return next
}

export function getInstalledSkills(): SkillDefinition[] {
  const state = loadSkillState()
  return normalizeSkills(getAllKnownSkills().map((skill) => (skill.source === 'builder' ? skill : { ...skill, enabled: state[skill.id] ?? skill.enabled })))
}

export function getAllKnownSkills(): SkillDefinition[] {
  return normalizeSkills([...INSTALLED_SKILLS.map((skill) => ({ ...skill, source: 'core' as const })), ...getInstalledMarketplaceSkills(), ...getBuiltSkillDefinitions()])
}

export function getEnabledSkills(): SkillDefinition[] {
  return getInstalledSkills().filter((skill) => skill.enabled)
}

export function getEnabledToolNames() {
  return getExecutableToolNames(getEnabledSkills())
}

export function getEnabledSystemPromptAdditions() {
  return getEnabledSkills().flatMap((skill) => skill.systemPromptAdditions)
}

export function getOpenAIToolsForEnabledSkills(): OpenAIToolDefinition[] {
  return getEnabledSkills().flatMap((skill) =>
    getExecutableSkillTools(skill).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  )
}

export function getOpenAIToolsForSelectedSkills(skillIds: string[]): OpenAIToolDefinition[] {
  const selected = new Set(skillIds)
  const skills = getEnabledSkills().filter((skill) => selected.has(skill.id))
  return skills.flatMap((skill) =>
    getExecutableSkillTools(skill).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  )
}

export type { SkillDefinition } from './types'
export {
  normalizeSkill,
  normalizeSkills,
  selectSkillsForRequest,
  getSkillRuntimeStat,
  getSkillRuntimeStats,
  recordSkillExecution,
  findSkillForTool,
}
export {
  getMarketplaceItems,
  installMarketplaceItem,
  isMarketplaceItemInstalled,
  uninstallMarketplaceItem,
} from './marketplace'
export type { MarketplaceItem } from './types'
