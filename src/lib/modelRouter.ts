import type { AppSettings, ModelMode } from '../types/settings'

export interface ModelSelection {
  mode: ModelMode
  model: string
  temperature: number
  maxTokens: number
  reason: string
  reviewAfter: boolean
}

const codeSignals = [
  /\b(code|coding|bug|debug|fix|refactor|typescript|javascript|react|tauri|rust|css|html|api|component|frontend|backend)\b/i,
  /\b(read|write|edit|create|patch|diff|inspect|package\.json|src\/|src\\|terminal|command|build|test|error|stack trace|repo|project folder|file)\b/i,
  /\.(ts|tsx|js|jsx|rs|json|css|html|md)\b/i,
  /\b(npm|pnpm|yarn|cargo|git|powershell|cmd|eslint|vite|tailwind)\b/i,
]

const reviewSignals = [
  /\b(review|double[- ]?check|audit|second opinion|critique|verify|validate|risky|risk|before editing|is this safe|safe)\b/i,
  /\b(failed twice|keeps failing|not sure|confidence|regression|architecture|security|performance|optimi[sz]e|find bugs|quality|edge cases)\b/i,
]

const reviewOnlySignals = [
  /^\s*(review|check|audit|find bugs|is this safe|architecture review)\b/i,
  /\b(no edits?|do not edit|without editing|just review)\b/i,
]

const casualSignals = [
  /^(hi|hello|hey|yo|sup|what'?s up|wyd|thanks|thank you|ok|okay|bet|nice)[.!?\s]*$/i,
  /^(good morning|good afternoon|good evening|good night)[.!?\s]*$/i,
]

function pickMode(settings: AppSettings, userText: string): ModelMode {
  const configuredMode = settings.modelMode ?? 'auto'
  if (configuredMode !== 'auto') return configuredMode

  const hasWorkspace = Boolean(settings.projectFolder)
  const wantsWorkspaceResume = hasWorkspace && /\b(this project|this app|workspace|project|repo|continue|resume|welcome back|where were we|last worked|recent files|recent errors)\b/i.test(userText)
  const wantsCode = codeSignals.some((pattern) => pattern.test(userText))
  const wantsReview = reviewSignals.some((pattern) => pattern.test(userText))
  const reviewOnly = reviewOnlySignals.some((pattern) => pattern.test(userText))
  const explicitlyNoEdits = /\b(no edits?|do not edit|don't edit|without editing|just review)\b/i.test(userText)
  const asksForChanges = /\b(fix|implement|change|build|create|edit|patch)\b/i.test(userText) && !explicitlyNoEdits

  if (wantsReview && reviewOnly && !asksForChanges) return 'review'
  if (wantsCode || wantsWorkspaceResume) return 'code'
  if (wantsReview) return 'review'
  return 'fast'
}

export function shouldReviewAfterCode(settings: AppSettings, userText: string) {
  if (!settings.enableAutomaticReviewPass) return false
  if (!codeSignals.some((pattern) => pattern.test(userText))) return false
  return reviewSignals.some((pattern) => pattern.test(userText))
}

export function selectModelForRequest(settings: AppSettings, userText: string): ModelSelection {
  const mode = pickMode(settings, userText)
  const fallbackModel = settings.model || settings.codeModel || settings.fastModel
  const singleModel = settings.singleModelEnabled ? (settings.singleModel || settings.model) : ''
  const isCasual = casualSignals.some((pattern) => pattern.test(userText.trim()))
  const providerModel =
    settings.modelProvider === '9router'
      ? (settings.nineRouterModel || '')
      : settings.modelProvider === 'openrouter'
        ? (settings.openRouterModel || '')
        : ''

  if (providerModel) {
    const routed = selectModelForRequest({ ...settings, modelProvider: 'lmstudio' }, userText)
    return {
      ...routed,
      model: providerModel,
      reason: `${settings.modelProvider === 'openrouter' ? 'OpenRouter' : '9Router'} provider selected; ${routed.reason}`,
    }
  }

  if (mode === 'fast') {
    return {
      mode,
      model: singleModel || settings.modelAssignments?.daily || settings.fastModel || fallbackModel,
      temperature: 0.45,
      maxTokens: isCasual ? 96 : Math.min(settings.maxTokens || 1024, 768),
      reason: isCasual ? 'Fast casual chat route with short reply cap.' : 'Fast daily chat route.',
      reviewAfter: false,
    }
  }

  if (mode === 'review') {
    return {
      mode,
      model: singleModel || settings.modelAssignments?.review || settings.reviewModel || fallbackModel,
      temperature: 0.35,
      maxTokens: Math.min(Math.max(settings.maxTokens || 3072, 2048), 4096),
      reason: 'Reviewer route for second-opinion or risk-heavy work.',
      reviewAfter: false,
    }
  }

  return {
    mode: 'code',
    model: singleModel || settings.modelAssignments?.code || settings.codeModel || fallbackModel,
    temperature: 0.25,
    maxTokens: Math.min(Math.max(settings.maxTokens || 4096, 2048), 4096),
    reason: shouldReviewAfterCode(settings, userText)
      ? 'Code/tool route followed by reviewer pass because the request is risk-heavy.'
      : settings.projectFolder && /\b(this project|this app|workspace|continue|resume|where were we|last worked|recent files|recent errors)\b/i.test(userText)
        ? 'Code/tool route because workspace awareness is relevant.'
        : 'Code/tool route for project work.',
    reviewAfter: shouldReviewAfterCode(settings, userText),
  }
}

export function modelLabel(settings: AppSettings) {
  if (settings.singleModelEnabled) return `Single: ${settings.singleModel || settings.model || 'no model selected'}`
  if (settings.modelProvider === '9router') return `9Router: ${settings.nineRouterModel || settings.model || 'no model selected'}`
  if (settings.modelProvider === 'openrouter') return `OpenRouter: ${settings.openRouterModel || settings.model || 'no model selected'}`
  const mode = settings.modelMode ?? 'auto'
  if (mode === 'fast') return `Fast: ${settings.modelAssignments?.daily || settings.fastModel || settings.model}`
  if (mode === 'code') return `Code: ${settings.modelAssignments?.code || settings.codeModel || settings.model}`
  if (mode === 'review') return `Review: ${settings.modelAssignments?.review || settings.reviewModel || settings.model}`
  return `Auto: ${settings.modelAssignments?.daily || settings.fastModel || 'fast'} / ${settings.modelAssignments?.code || settings.codeModel || 'code'}`
}
