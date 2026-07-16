import type { ChatMessage, LogEvent } from '../types/agent'
import type { NebulaContextBundle, NebulaContextSection } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { readFile, searchProjectFiles } from './fileSystem'
import { getProfileByFolder, getProjectProfile, formatProjectProfileForPrompt } from './projectProfiles'
import { buildUnifiedMemorySections } from './unifiedMemory'
import { buildWorkspaceAwareness, formatWorkspaceAwarenessForPrompt, getStoredWorkspaceAwareness } from './workspaceAwareness'
import { enabledContextPins } from './contextPins'

export interface NebulaContextHints {
  openedFile?: {
    path: string
    content: string
  } | null
  recentLogs?: LogEvent[]
}

const METADATA_FILES = [
  'package.json',
  'README.md',
  'readme.md',
  'src-tauri/tauri.conf.json',
  'vite.config.ts',
  'tsconfig.json',
]

function truncate(content: string, maxChars: number) {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars).trimEnd()}\n...[trimmed]`
}

function joinProjectPath(folder: string, file: string) {
  return `${folder.replace(/[\\/]+$/, '')}\\${file.replace(/^[\\/]+/, '')}`
}

function isProjectWork(text: string) {
  return /\b(code|file|project|repo|debug|fix|build|test|package\.json|readme|tauri|react|typescript|terminal|command|error|edit|diff|src[\\/])\b/i.test(text)
}

const PROJECT_SEARCH_STOP_WORDS = new Set([
  'about', 'active', 'answering', 'before', 'find', 'from', 'goal', 'inspect', 'into', 'look', 'project', 'search', 'show', 'that', 'the', 'this', 'where', 'with',
])

function explicitProjectSearchGoal(userText: string) {
  const marker = /^\[LOCAL PROJECT SEARCH\]\s*(?:Search and inspect the active project before answering\.\s*Goal:\s*)?/i
  return marker.test(userText) ? userText.replace(marker, '').trim() : ''
}

function projectSearchTerms(goal: string) {
  const quoted = Array.from(goal.matchAll(/["']([^"']{2,80})["']/g), (match) => match[1].trim())
  const words = (goal.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? [])
    .filter((word) => !PROJECT_SEARCH_STOP_WORDS.has(word))
  return Array.from(new Set([...quoted, ...words])).slice(0, 5)
}

async function buildExplicitProjectSearchSection(settings: AppSettings, userText: string): Promise<NebulaContextSection | null> {
  const goal = explicitProjectSearchGoal(userText)
  if (!goal) return null
  if (!settings.projectFolder) {
    return {
      id: 'project:explicit-search',
      title: 'Local Project Search',
      source: 'project',
      priority: 95,
      content: 'No project folder is selected. Ask the user to choose a project before claiming any local search result.',
    }
  }

  const terms = projectSearchTerms(goal)
  if (terms.length === 0) return null
  const resultGroups = await Promise.all(
    terms.map((term) => searchProjectFiles(settings.projectFolder, term, 12).catch(() => [])),
  )
  const matches = Array.from(
    new Map(resultGroups.flat().map((match) => [`${match.path}:${match.line}`, match])).values(),
  ).slice(0, 36)

  return {
    id: 'project:explicit-search',
    title: 'Local Project Search',
    source: 'project',
    priority: 95,
    content: matches.length
      ? `Goal: ${goal}\nSearch terms: ${terms.join(', ')}\nVerified local matches:\n${matches.map((match) => `- ${match.path}:${match.line} | ${match.text}`).join('\n')}`
      : `Goal: ${goal}\nSearch terms: ${terms.join(', ')}\nNo exact text matches were found in searchable project files. Do not invent matches; use file tools if broader inspection is needed.`,
  }
}

async function readProjectMetadata(settings: AppSettings, userText: string): Promise<NebulaContextSection[]> {
  if (!settings.projectFolder || !isProjectWork(userText)) return []

  const profile = getProjectProfile(settings.activeProjectProfileId) ?? getProfileByFolder(settings.projectFolder)
  const files = Array.from(new Set([...(profile?.metadataFiles ?? []), ...METADATA_FILES])).slice(0, 8)
  const pairs = await Promise.all(
    files.map(async (file) => {
      const path = joinProjectPath(settings.projectFolder, file)
      const content = await readFile(path).catch(() => '')
      return content ? { file, path, content: truncate(content, file.toLowerCase().includes('readme') ? 2200 : 1600) } : null
    }),
  )

  return pairs
    .filter((pair): pair is { file: string; path: string; content: string } => Boolean(pair))
    .map((pair, index) => ({
      id: `project:file:${pair.file}`,
      title: `Project Metadata: ${pair.file}`,
      source: 'file' as const,
      priority: 66 - index,
      content: `Path: ${pair.path}\n${pair.content}`,
    }))
}

function buildConversationSection(history: ChatMessage[]): NebulaContextSection | null {
  const recent = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8)

  if (recent.length === 0) return null

  return {
    id: 'conversation:recent',
    title: 'Recent Conversation Continuity',
    source: 'conversation',
    priority: 58,
    content: recent
      .map((message) => `${message.role.toUpperCase()}: ${truncate(message.content.replace(/\s+/g, ' ').trim(), 420)}`)
      .join('\n'),
  }
}

function buildOpenedFileSection(hints: NebulaContextHints): NebulaContextSection | null {
  if (!hints.openedFile) return null

  return {
    id: `opened:${hints.openedFile.path}`,
    title: 'Currently Open File',
    source: 'file',
    priority: 88,
    content: `Path: ${hints.openedFile.path}\n${truncate(hints.openedFile.content, 5200)}`,
  }
}

function buildRecentLogSection(hints: NebulaContextHints): NebulaContextSection | null {
  const logs = (hints.recentLogs ?? [])
    .filter((log) => /tool|command|file|read|write|error|project|model|route/i.test(`${log.type} ${log.message}`))
    .slice(-10)

  if (logs.length === 0) return null

  return {
    id: 'logs:recent-actions',
    title: 'Recent Nebula Actions',
    source: 'log',
    priority: 44,
    content: logs.map((log) => `- ${log.type}: ${truncate(log.message.replace(/\s+/g, ' ').trim(), 260)}`).join('\n'),
  }
}

function trimSectionsToBudget(sections: NebulaContextSection[], budgetChars: number) {
  const selected: NebulaContextSection[] = []
  let used = 0

  for (const section of [...sections].sort((a, b) => b.priority - a.priority)) {
    const headerCost = section.title.length + 12
    const remaining = budgetChars - used - headerCost
    if (remaining <= 240) continue

    const content = truncate(section.content, remaining)
    selected.push({ ...section, content })
    used += content.length + headerCost
  }

  return selected
}

export async function buildNebulaContext(
  settings: AppSettings,
  userText: string,
  history: ChatMessage[],
  hints: NebulaContextHints = {},
): Promise<NebulaContextBundle> {
  const budgetChars = Math.max(4000, Math.min(settings.contextBudgetChars ?? 18000, 40000))
  const lightweightChat = userText.trim().length < 80 && /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|how are you|what'?s up)[.!?\s]*$/i.test(userText.trim())
  if (lightweightChat) {
    const prompt = 'No project or memory context is needed for this lightweight conversation.'
    return {
      id: crypto.randomUUID(),
      prompt,
      sections: [],
      totalChars: prompt.length,
      budgetChars,
      summary: {
        memoryHits: 0,
        projectFiles: [],
        recentTasks: 0,
        recentMessages: history.filter((message) => message.role === 'user' || message.role === 'assistant').slice(-8).length,
      },
      createdAt: new Date().toISOString(),
    }
  }

  const projectProfile = getProjectProfile(settings.activeProjectProfileId) ?? (settings.projectFolder ? getProfileByFolder(settings.projectFolder) : null)
  const storedWorkspace = settings.projectFolder ? getStoredWorkspaceAwareness(settings.projectFolder) : null
  const [memorySections, workspaceSnapshot, metadataSections, explicitProjectSearchSection] = await Promise.all([
    buildUnifiedMemorySections(settings, userText),
    storedWorkspace
      ? Promise.resolve(storedWorkspace)
      : settings.projectFolder
        ? buildWorkspaceAwareness(settings, {
            openedFile: hints.openedFile,
            logs: hints.recentLogs,
          }, { refreshGit: false }).catch(() => null)
        : Promise.resolve(null),
    readProjectMetadata(settings, userText),
    buildExplicitProjectSearchSection(settings, userText),
  ])
  const openedFileSection = buildOpenedFileSection(hints)
  const conversationSection = buildConversationSection(history)
  const logSection = buildRecentLogSection(hints)
  const pinnedSections: NebulaContextSection[] = enabledContextPins(settings.projectFolder).map((pin, index) => ({
    id: `pin:${pin.id}`,
    title: `Pinned Context: ${pin.label}`,
    source: pin.source === 'file' ? 'file' : pin.source === 'memory' ? 'memory' : 'system',
    priority: 96 - index,
    content: `${pin.path ? `Path: ${pin.path}\n` : ''}${truncate(pin.content, 6000)}`,
  }))
  const workspaceSection: NebulaContextSection | null = workspaceSnapshot
    ? {
        id: 'workspace:awareness',
        title: 'Workspace Awareness',
        source: 'project',
        priority: 92,
        content: formatWorkspaceAwarenessForPrompt(workspaceSnapshot),
      }
    : null
  const projectSection: NebulaContextSection = {
    id: 'project:profile',
    title: 'Active Project Profile',
    source: 'project',
    priority: 76,
    content: formatProjectProfileForPrompt(projectProfile),
  }

  const rawSections = [
    ...pinnedSections,
    ...memorySections,
    workspaceSection,
    explicitProjectSearchSection,
    projectSection,
    ...metadataSections,
    openedFileSection,
    conversationSection,
    logSection,
  ].filter((section): section is NebulaContextSection => Boolean(section))

  const sections = settings.contextInjectionEnabled === false ? [] : trimSectionsToBudget(rawSections, budgetChars)
  const prompt = sections.length
    ? `Unified Nebula context. Use only what is relevant; ignore stale or unrelated details. Do not expose internal routing/model names to the user unless debug mode is explicitly requested.\n\n${sections
        .map((section) => `## ${section.title}\n${section.content}`)
        .join('\n\n')}`
    : 'Unified Nebula context: context injection is disabled or no relevant local context was found.'

  return {
    id: crypto.randomUUID(),
    prompt,
    sections,
    totalChars: prompt.length,
    budgetChars,
    summary: {
      memoryHits: memorySections.find((section) => section.id === 'memory:search')?.content.split(/\r?\n/).filter(Boolean).length ?? 0,
      projectFiles: metadataSections.map((section) => section.title.replace('Project Metadata: ', '')),
      openedFile: hints.openedFile?.path,
      recentTasks: memorySections.some((section) => section.id === 'memory:tasks') ? 1 : 0,
      recentMessages: history.filter((message) => message.role === 'user' || message.role === 'assistant').slice(-8).length,
    },
    createdAt: new Date().toISOString(),
  }
}
