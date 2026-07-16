import type { MemoryFile } from '../types/memory'
import type { MemoryCoreCategory, MemoryIndexEntry, MemorySearchRankedResult } from '../types/nebula'
import { appendMemory, readMemory, writeMemory } from './memory'
import { getMemoryCoreCategories } from './commandCenter'

function keywords(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9_/\-.\\ ]+/g, ' ')
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 2),
    ),
  ).slice(0, 40)
}

function scoreEntry(entry: MemoryIndexEntry, queryWords: string[]) {
  if (queryWords.length === 0) return 0
  const haystack = `${entry.text} ${entry.keywords.join(' ')}`.toLowerCase()
  return queryWords.reduce((score, word) => {
    if (entry.text.toLowerCase().includes(word)) return score + 5
    if (entry.keywords.includes(word)) return score + 3
    if (haystack.includes(word)) return score + 1
    return score
  }, 0)
}

export async function buildMemoryIndex(memoryFolder: string): Promise<MemoryIndexEntry[]> {
  const categories = getMemoryCoreCategories()
  const entries = await Promise.all(categories.map((category) => indexCategory(memoryFolder, category)))
  return entries.flat()
}

async function indexCategory(memoryFolder: string, category: MemoryCoreCategory) {
  const content = await readMemory(memoryFolder, category.file).catch(() => '')
  return content
    .split(/\r?\n/)
    .map((text, index): MemoryIndexEntry | null => {
      const trimmed = text.trim()
      if (!trimmed || trimmed.startsWith('#')) return null
      return {
        id: `${category.id}:${index + 1}:${trimmed.slice(0, 36)}`,
        categoryId: category.id,
        file: category.file,
        line: index + 1,
        text: trimmed,
        keywords: keywords(trimmed),
        updatedAt: new Date().toISOString(),
      }
    })
    .filter(Boolean) as MemoryIndexEntry[]
}

export async function searchMemoryIndex(memoryFolder: string, query: string, limit = 12): Promise<MemorySearchRankedResult[]> {
  const queryWords = keywords(query)
  const entries = await buildMemoryIndex(memoryFolder)
  return entries
    .map((entry) => {
      const score = scoreEntry(entry, queryWords)
      return {
        ...entry,
        score,
        reason: score > 0 ? `Matched ${entry.file} line ${entry.line}.` : 'Low-confidence category fallback.',
      }
    })
    .filter((entry) => entry.score > 0 || queryWords.length === 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, Math.max(1, limit))
}

export async function rememberMemoryCore(memoryFolder: string, categoryId: MemoryCoreCategory['id'], content: string) {
  const category = getMemoryCoreCategories().find((item) => item.id === categoryId)
  if (!category) throw new Error(`Unknown Memory Core category: ${categoryId}`)
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Memory content is empty.')
  const entry = `\n- ${new Date().toISOString()}: ${trimmed}\n`
  await appendMemory(memoryFolder, category.file, entry)
  return { file: category.file, content: entry }
}

export async function forgetMemoryCore(memoryFolder: string, file: MemoryFile, line: number) {
  const content = await readMemory(memoryFolder, file)
  const lines = content.split(/\r?\n/)
  const index = line - 1
  if (index < 0 || index >= lines.length) throw new Error(`Line ${line} is outside ${file}.`)
  const removed = lines[index]
  lines.splice(index, 1)
  await writeMemory(memoryFolder, file, lines.join('\n'))
  return { file, line, removed }
}
