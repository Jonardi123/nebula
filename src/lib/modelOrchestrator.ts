import type { NebulaRouteDecision, RegisteredNebulaModel } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import type { SkillMatch } from '../skills/types'
import { modelModeToRole, warmModelInBackground, type ModelRole } from './modelManager'
import { recordRouteDecision } from './orchestratorDiagnostics'
import { selectModelForRequest, type ModelSelection } from './modelRouter'
import { getEnabledSkills, selectSkillsForRequest } from '../skills'

export interface OrchestratedRequest {
  selection: ModelSelection
  decision: NebulaRouteDecision
  registry: RegisteredNebulaModel[]
  skillMatches: SkillMatch[]
}

const complexSignals = [
  /\b(architecture|security|performance|review|audit|risky|large change|refactor|optimi[sz]e|fails twice|regression)\b/i,
  /\b(database|auth|credentials|shell|terminal|delete|migration|build pipeline|release)\b/i,
]

let lastWarmKey = ''
let lastWarmAt = 0

function roleModel(settings: AppSettings, role: ModelRole) {
  if (role === 'daily') return settings.modelAssignments?.daily || settings.fastModel || settings.model
  if (role === 'code') return settings.modelAssignments?.code || settings.codeModel || settings.model
  return settings.modelAssignments?.review || settings.reviewModel || settings.model
}

export function getRegisteredNebulaModels(settings: AppSettings): RegisteredNebulaModel[] {
  return [
    {
      id: roleModel(settings, 'daily'),
      role: 'daily',
      label: 'Daily Brain',
      purpose: 'Quick chat, summaries, voice replies, and lightweight reasoning.',
      preferredFor: ['conversation', 'voice', 'simple answers', 'summaries'],
      fallbackModels: [settings.model, settings.codeModel].filter(Boolean),
      keepWarm: settings.keepDailyModelWarm,
      idleUnloadMs: 0,
    },
    {
      id: roleModel(settings, 'code'),
      role: 'code',
      label: 'Coding Brain',
      purpose: 'Programming, file inspection, tool use, debugging, and integration work.',
      preferredFor: ['code', 'files', 'terminal', 'debugging', 'project tasks'],
      fallbackModels: [roleModel(settings, 'daily'), settings.model].filter(Boolean),
      keepWarm: Boolean(settings.backgroundPreloadCodeModel && settings.projectFolder),
      idleUnloadMs: settings.heavyModelIdleUnloadMs,
    },
    {
      id: roleModel(settings, 'review'),
      role: 'review',
      label: 'Review Brain',
      purpose: 'Senior checks for correctness, safety, architecture, and performance.',
      preferredFor: ['review', 'audit', 'security', 'architecture', 'performance'],
      fallbackModels: [roleModel(settings, 'code'), roleModel(settings, 'daily')].filter(Boolean),
      keepWarm: false,
      idleUnloadMs: settings.heavyModelIdleUnloadMs,
    },
  ]
}

function routeConfidence(selection: ModelSelection, userText: string) {
  if (selection.mode === 'fast' && userText.length < 80) return 88
  if (selection.mode === 'code' && /\b(code|file|debug|fix|build|test|package\.json|src[\\/]|terminal|command)\b/i.test(userText)) return 92
  if (selection.mode === 'review' && /\b(review|audit|check|safe|architecture|bugs)\b/i.test(userText)) return 91
  return 74
}

export function orchestrateRequest(settings: AppSettings, userText: string): OrchestratedRequest {
  const selection = selectModelForRequest(settings, userText)
  const skillMatches = selectSkillsForRequest(getEnabledSkills(), userText, 5)
  const role = modelModeToRole(selection.mode)
  const concreteMode: NebulaRouteDecision['mode'] =
    selection.mode === 'code' || selection.mode === 'review' ? selection.mode : 'fast'
  const secondOpinion = selection.reviewAfter || complexSignals.some((pattern) => pattern.test(userText))
  const mergeStrategy: NebulaRouteDecision['mergeStrategy'] =
    selection.mode === 'code' && secondOpinion
      ? 'append_review'
      : selection.mode === 'review'
        ? 'primary_only'
        : secondOpinion
          ? 'compare_then_merge'
          : 'primary_only'

  const decision: NebulaRouteDecision = {
    id: crypto.randomUUID(),
    mode: concreteMode,
    requestedModel: selection.model,
    role,
    reason: selection.reason,
    reviewAfter: selection.reviewAfter,
    secondOpinion,
    mergeStrategy,
    confidence: routeConfidence(selection, userText),
    debugLabel: `${role}:${selection.model}`,
    selectedSkills: skillMatches.map((match) => ({
      id: match.skill.id,
      name: match.skill.name,
      confidence: match.confidence,
      reason: match.reason,
    })),
    createdAt: new Date().toISOString(),
  }

  recordRouteDecision(decision)
  window.dispatchEvent(new CustomEvent('nebula-route-decision', { detail: decision }))
  return {
    selection,
    decision,
    registry: getRegisteredNebulaModels(settings),
    skillMatches,
  }
}

export function predictRouteForDraft(settings: AppSettings, draft: string) {
  const text = draft.trim()
  if (text.length < 10) return null
  const selection = selectModelForRequest(settings, text)
  return {
    selection,
    role: modelModeToRole(selection.mode),
  }
}

export function warmPredictedModelInBackground(settings: AppSettings, draft: string, reason = 'User is typing.') {
  if (!settings.autoLoadModels || !settings.warmModelWhileTyping) return
  const prediction = predictRouteForDraft(settings, draft)
  if (!prediction) return

  const now = Date.now()
  const key = `${prediction.role}:${prediction.selection.model}`
  if (key === lastWarmKey && now - lastWarmAt < 20000) return
  lastWarmKey = key
  lastWarmAt = now

  warmModelInBackground(settings, prediction.role, reason)
}
