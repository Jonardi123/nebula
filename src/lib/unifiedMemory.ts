import type { NebulaContextSection } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { readMemory, searchMemory } from './memory'
import { getTaskRuns } from './tasks'
import { getStoredWorkspaceAwareness } from './workspaceAwareness'

const CORE_MEMORY_FILES = ['user.md', 'preferences.md', 'projects.md', 'lessons_learned.md'] as const

function compactLines(content: string, maxLines: number) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .join('\n')
}

function truncate(content: string, maxChars: number) {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars).trimEnd()}\n...[trimmed]`
}

export async function buildUnifiedMemorySections(settings: AppSettings, query: string): Promise<NebulaContextSection[]> {
  if (!settings.memoryFolder) return []

  const sections: NebulaContextSection[] = []
  const workspace = settings.projectFolder ? getStoredWorkspaceAwareness(settings.projectFolder) : null
  if (workspace) {
    sections.push({
      id: 'memory:workspace-resume',
      title: 'Workspace Resume State',
      source: 'project',
      priority: 78,
      content: [
        ...workspace.welcomeLines,
        workspace.openedFile ? `Opened file: ${workspace.openedFile}` : '',
        workspace.recentFiles.length ? `Recent files: ${workspace.recentFiles.slice(0, 5).join(', ')}` : '',
        workspace.recentlyEditedFiles.length ? `Recently edited files: ${workspace.recentlyEditedFiles.slice(0, 5).join(', ')}` : '',
        workspace.recentErrors.length ? `Recent errors: ${workspace.recentErrors.slice(0, 3).map((item) => item.title).join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })
  }

  const hits = await searchMemory(settings.memoryFolder, query).catch(() => [])
  if (hits.length > 0) {
    sections.push({
      id: 'memory:search',
      title: 'Relevant Memory Hits',
      source: 'memory',
      priority: 95,
      content: hits
        .slice(0, 16)
        .map((hit) => `- ${hit.file}:${hit.line} ${hit.text}`)
        .join('\n'),
    })
  }

  const coreMemories = await Promise.all(
    CORE_MEMORY_FILES.map(async (file) => {
      const content = await readMemory(settings.memoryFolder, file).catch(() => '')
      const compact = compactLines(content, file === 'preferences.md' ? 16 : 10)
      return compact ? `## ${file}\n${compact}` : ''
    }),
  )

  const coreContent = coreMemories.filter(Boolean).join('\n\n')
  if (coreContent) {
    sections.push({
      id: 'memory:core',
      title: 'Core Long-Term Memory',
      source: 'memory',
      priority: 82,
      content: truncate(coreContent, 4200),
    })
  }

  const webMemory = await readMemory(settings.memoryFolder, 'web_learnings.md').catch(() => '')
  const usefulWebLines = compactLines(webMemory, 10)
  if (usefulWebLines) {
    sections.push({
      id: 'memory:web',
      title: 'Recent Web-Learned Memory',
      source: 'memory',
      priority: 48,
      content: usefulWebLines,
    })
  }

  const commandMemory = await readMemory(settings.memoryFolder, 'commands.md').catch(() => '')
  const usefulCommandLines = compactLines(commandMemory, 8)
  if (usefulCommandLines) {
    sections.push({
      id: 'memory:commands',
      title: 'Repeated Commands And Fixes',
      source: 'memory',
      priority: 46,
      content: usefulCommandLines,
    })
  }

  const recentTasks = getTaskRuns()
    .filter((task) => task.status === 'running' || task.finalResult)
    .slice(0, 5)

  if (recentTasks.length > 0) {
    sections.push({
      id: 'memory:tasks',
      title: 'Recent And Active Tasks',
      source: 'task',
      priority: 72,
      content: recentTasks
        .map((task) => {
          const artifacts = [
            task.files.length ? `files=${task.files.slice(0, 5).join(', ')}` : '',
            task.commands.length ? `commands=${task.commands.slice(0, 3).join(' | ')}` : '',
          ]
            .filter(Boolean)
            .join('; ')
          return `- ${task.status}: ${task.goal}${artifacts ? ` (${artifacts})` : ''}${task.finalResult ? `\n  Result: ${truncate(task.finalResult, 360)}` : ''}`
        })
        .join('\n'),
    })
  }

  return sections
}
