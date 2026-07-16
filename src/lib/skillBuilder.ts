import type { SkillDraft } from '../types/nebula'
import type { SkillDefinition } from '../skills/types'

const SKILL_DRAFTS_KEY = 'nebula-skill-drafts'

function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(SKILL_DRAFTS_KEY) ?? '[]') as SkillDraft[]
  } catch {
    return []
  }
}

function writeDrafts(drafts: SkillDraft[]) {
  try {
    localStorage.setItem(SKILL_DRAFTS_KEY, JSON.stringify(drafts.slice(0, 80)))
  } catch {
    // Draft skills are local convenience state.
  }
}

export function getSkillDrafts() {
  return readDrafts()
}

export function saveSkillDraft(input: Omit<SkillDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = new Date().toISOString()
  const previous = input.id ? readDrafts().find((draft) => draft.id === input.id) : null
  const draft: SkillDraft = {
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
  writeDrafts([draft, ...readDrafts().filter((item) => item.id !== draft.id)])
  return draft
}

export function deleteSkillDraft(id: string) {
  writeDrafts(readDrafts().filter((draft) => draft.id !== id))
}

export function setSkillDraftEnabled(id: string, enabled: boolean) {
  const drafts = readDrafts().map((draft) => (draft.id === id ? { ...draft, enabled, updatedAt: new Date().toISOString() } : draft))
  writeDrafts(drafts)
}

export function getBuiltSkillDefinitions(): SkillDefinition[] {
  return readDrafts().map((draft) => ({
    id: `builder:${draft.id}`,
    name: draft.name,
    description: draft.description,
    enabled: draft.enabled,
    requiredPermissions: draft.permissions,
    tools: [],
    systemPromptAdditions: [
      `Prompt skill "${draft.name}": ${draft.description}`,
      ...draft.promptAdditions,
      draft.exposedTools.length
        ? `Declared tool metadata only, not executable in v1: ${draft.exposedTools.map((tool) => `${tool.name} (${tool.description})`).join('; ')}`
        : '',
    ].filter(Boolean),
    examples: draft.examples,
    riskLevel: draft.riskLevel,
    source: 'builder',
    version: 'local',
    author: 'Jonard',
    tags: ['local', 'prompt-pack'],
  }))
}
