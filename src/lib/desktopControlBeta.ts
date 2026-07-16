import type { AppSettings } from '../types/settings'
import { openApp } from './commandRunner'
import { webFetch, webSearch } from './web'

const knownApps = new Set(['notepad', 'calculator', 'calc', 'cmd', 'powershell', 'explorer'])

export function isKnownDesktopApp(app: string) {
  return knownApps.has(app.trim().toLowerCase())
}

export async function openKnownDesktopApp(app: string, settings: AppSettings) {
  if (!settings.desktopControlBetaEnabled) {
    throw new Error('Desktop Control Beta is disabled in Settings.')
  }
  const normalized = app.trim().toLowerCase()
  if (!isKnownDesktopApp(normalized)) {
    throw new Error(`Blocked unknown app: ${app}`)
  }
  await openApp(normalized)
  return `Opened known app: ${normalized}`
}

export async function runBrowserBetaAction(input: string, settings: AppSettings) {
  if (!settings.desktopControlBetaEnabled) {
    throw new Error('Desktop Control Beta is disabled in Settings.')
  }
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const fetched = await webFetch(trimmed, settings.memoryFolder)
    return `Fetched ${fetched.title}: ${fetched.summary}`
  }
  const results = await webSearch(trimmed, 4)
  return results.map((result) => `${result.title} - ${result.url}`).join('\n') || 'No web results.'
}
