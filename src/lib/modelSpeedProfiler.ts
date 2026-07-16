import type { ChatMessage } from '../types/agent'
import type { ModelSpeedProfileResult } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { streamChat } from './lmstudio'
import { recordModelError, recordModelRun } from './modelStats'

const PROFILE_KEY = 'nebula-model-speed-profiles'

function readProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as ModelSpeedProfileResult[]) : []
  } catch {
    return []
  }
}

function writeProfiles(results: ModelSpeedProfileResult[]) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(results.slice(0, 80)))
    window.dispatchEvent(new CustomEvent('nebula-model-profiler-changed'))
  } catch {
    // Diagnostic data should never break normal chat.
  }
}

export function getModelSpeedProfiles() {
  return readProfiles()
}

export function modelForProfileRole(settings: AppSettings, role: ModelSpeedProfileResult['role']) {
  if (role === 'daily') return settings.modelAssignments?.daily || settings.fastModel || settings.model
  if (role === 'code') return settings.modelAssignments?.code || settings.codeModel || settings.model
  return settings.modelAssignments?.review || settings.reviewModel || settings.model
}

function promptForRole(role: ModelSpeedProfileResult['role']) {
  if (role === 'daily') return 'Reply in one short sentence: Nebula daily chat is ready.'
  if (role === 'code') return 'In one short paragraph, explain how you would inspect a TypeScript build error before editing files.'
  return 'Briefly review this claim for correctness and safety: local AI tools should log tool use and cite current web sources.'
}

export async function runModelSpeedProfile(settings: AppSettings, role: ModelSpeedProfileResult['role']) {
  const model = modelForProfileRole(settings, role)
  const started = performance.now()
  let firstTokenMs: number | undefined
  let output = ''

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: promptForRole(role),
    createdAt: new Date().toISOString(),
  }

  try {
    output = await streamChat(
      {
        ...settings,
        model,
        maxTokens: role === 'daily' ? 96 : 240,
        temperature: 0.2,
      },
      [message],
      (token) => {
        if (firstTokenMs === undefined) firstTokenMs = performance.now() - started
        output += token
      },
    )

    const totalMs = performance.now() - started
    const words = Math.max(1, output.split(/\s+/).filter(Boolean).length)
    const result: ModelSpeedProfileResult = {
      id: crypto.randomUUID(),
      role,
      model,
      ok: true,
      totalMs,
      firstTokenMs,
      roughTokensPerSecond: Number(((words * 1.25) / Math.max(totalMs / 1000, 0.1)).toFixed(2)),
      outputPreview: output.slice(0, 600),
      createdAt: new Date().toISOString(),
    }
    writeProfiles([result, ...readProfiles()])
    recordModelRun(model, totalMs, output, { role, lastFirstTokenMs: firstTokenMs })
    return result
  } catch (error) {
    const totalMs = performance.now() - started
    const messageText = error instanceof Error ? error.message : String(error)
    const result: ModelSpeedProfileResult = {
      id: crypto.randomUUID(),
      role,
      model,
      ok: false,
      totalMs,
      outputPreview: '',
      error: messageText,
      createdAt: new Date().toISOString(),
    }
    writeProfiles([result, ...readProfiles()])
    recordModelError(model, messageText)
    return result
  }
}
