import type { MemoryQualityScore } from '../types/nebula'
import { buildMemoryIndex } from './memoryIndex'

const URL_PATTERN = /https?:\/\/\S+/i
const DATE_PATTERN = /\b(20\d{2})-(\d{2})-(\d{2})\b/

export async function assessMemoryQuality(memoryFolder: string): Promise<MemoryQualityScore[]> {
  const entries = await buildMemoryIndex(memoryFolder)
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = entry.text.toLowerCase().replace(/\s+/g, ' ').trim()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return entries.map((entry) => {
    const reasons: string[] = []
    let score = 100
    let status: MemoryQualityScore['status'] = 'healthy'
    const normalized = entry.text.toLowerCase().replace(/\s+/g, ' ').trim()
    if ((counts.get(normalized) ?? 0) > 1) {
      score -= 35
      status = 'duplicate'
      reasons.push('Duplicate memory text.')
    }
    if (/temporary|for now|today only|ignore later|random/i.test(entry.text)) {
      score -= 30
      status = 'temporary'
      reasons.push('Looks temporary rather than reusable.')
    }
    if (entry.file === 'web_learnings.md') {
      const date = entry.text.match(DATE_PATTERN)?.[0]
      if (!URL_PATTERN.test(entry.text)) {
        score -= 40
        status = 'needs_source'
        reasons.push('Web learning has no source URL.')
      }
      if (!date) {
        score -= 25
        if (status === 'healthy') status = 'stale'
        reasons.push('Web learning has no checked date.')
      } else {
        const ageDays = (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000
        if (Number.isFinite(ageDays) && ageDays > 120) {
          score -= 35
          status = 'stale'
          reasons.push(`Checked ${Math.floor(ageDays)} days ago; verify before reuse.`)
        }
      }
    }
    if (reasons.length === 0) reasons.push('Reusable and sufficiently specific.')
    return {
      id: entry.id,
      file: entry.file,
      line: entry.line,
      content: entry.text,
      score: Math.max(0, score),
      status,
      reasons,
      checkedAt: new Date().toISOString(),
    }
  })
}
