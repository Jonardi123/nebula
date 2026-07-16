import type { SourceCard } from '../types/nebula'
import { writeLocalJson } from './safeStorage'
import type { WebFetchResult, WebSearchResult } from './web'
import { proposeMemory } from './memoryInbox'

const SOURCE_CARDS_KEY = 'nebula-source-cards'

function readCards() {
  try {
    return JSON.parse(localStorage.getItem(SOURCE_CARDS_KEY) ?? '[]') as SourceCard[]
  } catch {
    return []
  }
}

function writeCards(cards: SourceCard[]) {
  try {
    writeLocalJson(SOURCE_CARDS_KEY, cards.slice(0, 200))
    window.dispatchEvent(new CustomEvent('nebula-sources-changed'))
  } catch {
    // Source cards are useful history, not required for live answers.
  }
}

function trustHints(url: string) {
  const hints: string[] = []
  try {
    const parsed = new URL(url)
    hints.push(parsed.hostname.replace(/^www\./, ''))
    if (parsed.protocol === 'https:') hints.push('https')
    if (/\b(github\.com|microsoft\.com|developer\.mozilla\.org|docs\.|npmjs\.com|tauri\.app)\b/i.test(parsed.hostname)) {
      hints.push('developer source')
    }
  } catch {
    hints.push('url needs review')
  }
  return hints
}

function upsert(card: SourceCard) {
  const cards = readCards()
  const next = [card, ...cards.filter((item) => item.url !== card.url)].slice(0, 200)
  writeCards(next)
  return card
}

export function getSourceCards() {
  return readCards()
}

export function getSourceCard(id: string) {
  return readCards().find((card) => card.id === id) ?? null
}

export function createSourceCardsFromSearch(results: WebSearchResult[], taskId?: string) {
  return results.map((result) =>
    upsert({
      id: crypto.randomUUID(),
      title: result.title || result.url,
      url: result.url,
      snippet: result.snippet || '',
      dateChecked: result.date || new Date().toISOString(),
      trustHints: trustHints(result.url),
      taskId,
      createdAt: new Date().toISOString(),
    }),
  )
}

export function createSourceCardFromFetch(result: WebFetchResult, taskId?: string) {
  return upsert({
    id: crypto.randomUUID(),
    title: result.title || result.url,
    url: result.url,
    snippet: result.summary,
    summary: result.summary,
    dateChecked: result.dateChecked,
    trustHints: trustHints(result.url),
    taskId,
    createdAt: new Date().toISOString(),
  })
}

export function saveSourceCardToMemory(cardId: string) {
  const card = getSourceCard(cardId)
  if (!card) throw new Error('Source card not found.')
  const content = [
    `- ${card.title}`,
    `  Source: ${card.url}`,
    `  Date checked: ${card.dateChecked}`,
    `  Finding: ${card.summary || card.snippet}`,
    '  Verification: needs verification if used after today.',
  ].join('\n')
  const proposal = proposeMemory('web_learnings.md', content, `Source card saved from ${card.url}`, card.id)
  const cards = readCards().map((item) => (item.id === card.id ? { ...item, savedToMemory: true } : item))
  writeCards(cards)
  return proposal
}
