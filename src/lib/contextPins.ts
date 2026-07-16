import type { ContextPin } from '../types/nebula'
import { readLocalJson, writeLocalJson } from './safeStorage'

const CONTEXT_PINS_KEY = 'nebula-context-pins-v1'
const CONTEXT_PINS_EVENT = 'nebula-context-pins-changed'
const MAX_PINS = 24

function normalize(value: unknown): ContextPin[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is ContextPin => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.content === 'string'))
    .map((pin) => ({ ...pin, enabled: pin.enabled !== false }))
    .slice(0, MAX_PINS)
}

export function getContextPins() {
  return readLocalJson<ContextPin[]>(CONTEXT_PINS_KEY, [], normalize)
}

export function saveContextPin(input: Omit<ContextPin, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const pins = getContextPins()
  const timestamp = new Date().toISOString()
  const previous = input.id ? pins.find((pin) => pin.id === input.id) : undefined
  const pin: ContextPin = {
    ...input,
    id: input.id || crypto.randomUUID(),
    label: input.label.trim().slice(0, 80) || 'Pinned context',
    content: input.content.trim().slice(0, 12000),
    enabled: input.enabled !== false,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  writeLocalJson(CONTEXT_PINS_KEY, [pin, ...pins.filter((item) => item.id !== pin.id)].slice(0, MAX_PINS), CONTEXT_PINS_EVENT)
  return pin
}

export function toggleContextPin(id: string) {
  const pins = getContextPins().map((pin) => pin.id === id ? { ...pin, enabled: !pin.enabled, updatedAt: new Date().toISOString() } : pin)
  writeLocalJson(CONTEXT_PINS_KEY, pins, CONTEXT_PINS_EVENT)
  return pins.find((pin) => pin.id === id) ?? null
}

export function deleteContextPin(id: string) {
  writeLocalJson(CONTEXT_PINS_KEY, getContextPins().filter((pin) => pin.id !== id), CONTEXT_PINS_EVENT)
}

export function enabledContextPins(projectFolder?: string) {
  const normalized = projectFolder?.toLowerCase()
  return getContextPins().filter((pin) => pin.enabled && (!pin.projectFolder || pin.projectFolder.toLowerCase() === normalized))
}
