import { invoke } from '@tauri-apps/api/core'
import type { MemoryFile, MemorySearchResult } from '../types/memory'
import { isTauriRuntime } from './runtime'

export const MEMORY_FILES: MemoryFile[] = [
  'user.md',
  'projects.md',
  'web_learnings.md',
  'pc_fixes.md',
  'lessons_learned.md',
  'commands.md',
  'preferences.md',
]

export async function ensureMemory(memoryFolder: string) {
  if (!isTauriRuntime()) {
    try {
      for (const file of MEMORY_FILES) {
        const key = `${memoryFolder}/${file}`
        if (!localStorage.getItem(key)) localStorage.setItem(key, `# ${file}\n`)
      }
    } catch {
      // Browser storage is a desktop fallback only; native memory remains authoritative.
    }
    return
  }
  await invoke('ensure_memory', { memoryFolder, files: MEMORY_FILES })
}

export async function readMemory(memoryFolder: string, file: MemoryFile) {
  if (!isTauriRuntime()) {
    try {
      return localStorage.getItem(`${memoryFolder}/${file}`) ?? `# ${file}\n`
    } catch {
      return `# ${file}\n`
    }
  }
  return invoke<string>('read_memory', { memoryFolder, file })
}

export async function appendMemory(memoryFolder: string, file: MemoryFile, content: string) {
  if (!isTauriRuntime()) {
    const key = `${memoryFolder}/${file}`
    try {
      localStorage.setItem(key, `${localStorage.getItem(key) ?? `# ${file}\n`}${content}`)
    } catch {
      // Keep the chat flow alive when fallback storage is unavailable.
    }
    return
  }
  await invoke('append_memory', { memoryFolder, file, content })
}

export async function writeMemory(memoryFolder: string, file: MemoryFile, content: string) {
  if (!isTauriRuntime()) {
    try {
      localStorage.setItem(`${memoryFolder}/${file}`, content)
    } catch {
      // Keep the chat flow alive when fallback storage is unavailable.
    }
    return
  }
  await invoke('write_memory', { memoryFolder, file, content })
}

export async function searchMemory(memoryFolder: string, query: string): Promise<MemorySearchResult[]> {
  if (!isTauriRuntime()) {
    const needle = query.toLowerCase()
    return MEMORY_FILES.flatMap((file) => {
      let content = ''
      try {
        content = localStorage.getItem(`${memoryFolder}/${file}`) ?? ''
      } catch {
        // Leave content empty when fallback storage cannot be read.
      }
      return content
        .split(/\r?\n/)
        .map((text, index) => ({ file, line: index + 1, text }))
        .filter((result) => result.text.toLowerCase().includes(needle))
    }).slice(0, 40)
  }
  return invoke<MemorySearchResult[]>('search_memory', { memoryFolder, query })
}

export async function summarizeMemory(memoryFolder: string) {
  const files = await Promise.all(
    MEMORY_FILES.map(async (file) => {
      const content = await readMemory(memoryFolder, file)
      const preview = content.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
      return `## ${file}\n${preview || 'No saved notes yet.'}`
    }),
  )
  return files.join('\n\n')
}

export function formatMemoryLesson(content: string) {
  return `\n\n## ${new Date().toISOString()}\n${content.trim()}\n`
}
