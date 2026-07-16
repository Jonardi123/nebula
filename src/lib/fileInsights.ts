import type { FileInsight, FileSummary, WorkspaceAwarenessSnapshot } from '../types/nebula'
import type { FileNode } from './fileSystem'

const FILE_INSIGHTS_KEY = 'nebula-file-insights'

interface StoredFileInsights {
  favorites: string[]
  pins: string[]
  summaries: Record<string, FileSummary>
  references: Record<string, number>
}

function readStore(): StoredFileInsights {
  try {
    return {
      favorites: [],
      pins: [],
      summaries: {},
      references: {},
      ...JSON.parse(localStorage.getItem(FILE_INSIGHTS_KEY) ?? '{}'),
    }
  } catch {
    return { favorites: [], pins: [], summaries: {}, references: {} }
  }
}

function writeStore(store: StoredFileInsights) {
  try {
    localStorage.setItem(FILE_INSIGHTS_KEY, JSON.stringify(store))
    window.dispatchEvent(new CustomEvent('nebula-file-insights-changed'))
  } catch {
    // File insights are cached hints; keep the explorer usable if storage fails.
  }
}

function flatten(nodes: FileNode[] = []): FileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])])
}

function ext(path: string) {
  return path.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

function rel(path: string, projectFolder?: string) {
  if (!projectFolder) return path
  const normalized = path.replace(/\//g, '\\')
  const folder = projectFolder.replace(/\//g, '\\').replace(/[\\]+$/, '')
  return normalized.toLowerCase().startsWith(`${folder.toLowerCase()}\\`) ? normalized.slice(folder.length + 1) : normalized
}

function gitStatusFor(path: string, workspace?: WorkspaceAwarenessSnapshot | null) {
  if (!workspace?.git?.changedFiles?.length) return undefined
  const relative = rel(path, workspace.projectFolder)
  return workspace.git.changedFiles.some((file) => file.toLowerCase() === relative.toLowerCase()) ? 'changed' : undefined
}

function summaryFor(path: string, source: 'metadata' | 'background' = 'metadata'): FileSummary {
  const name = basename(path)
  const extension = ext(path)
  const kind =
    /^readme/i.test(name)
      ? 'Project documentation and setup notes.'
      : name === 'package.json'
        ? 'Project package metadata, scripts, and dependencies.'
        : extension === 'tsx'
          ? 'React TypeScript component or UI module.'
          : extension === 'ts'
            ? 'TypeScript module.'
            : extension === 'rs'
              ? 'Rust backend/native module.'
              : extension === 'css'
                ? 'Stylesheet.'
                : extension === 'json'
                  ? 'Structured configuration or data file.'
                  : 'Project file.'
  return {
    path,
    summary: kind,
    generatedAt: new Date().toISOString(),
    source,
  }
}

export function recordFileReference(path: string) {
  const store = readStore()
  store.references[path] = (store.references[path] ?? 0) + 1
  if (!store.summaries[path]) store.summaries[path] = summaryFor(path)
  writeStore(store)
}

export function toggleFavoriteFile(path: string) {
  const store = readStore()
  store.favorites = store.favorites.includes(path) ? store.favorites.filter((item) => item !== path) : [path, ...store.favorites]
  writeStore(store)
}

export function togglePinnedFile(path: string) {
  const store = readStore()
  store.pins = store.pins.includes(path) ? store.pins.filter((item) => item !== path) : [path, ...store.pins]
  writeStore(store)
}

export function getFileInsight(path: string, workspace?: WorkspaceAwarenessSnapshot | null) {
  const store = readStore()
  const relative = rel(path, workspace?.projectFolder)
  const lower = relative.toLowerCase()
  const recent = workspace?.recentFiles?.some((item) => item.toLowerCase() === lower) ?? false
  const edited = workspace?.recentlyEditedFiles?.some((item) => item.toLowerCase() === lower) ?? false
  const gitStatus = gitStatusFor(path, workspace)
  const references = store.references[path] ?? store.references[relative] ?? 0
  const importantName = /^(readme|package\.json|vite\.config|tsconfig|tauri\.conf|main\.|app\.|index\.)/i.test(basename(relative))
  const score =
    (store.pins.includes(path) ? 35 : 0) +
    (store.favorites.includes(path) ? 24 : 0) +
    (gitStatus ? 24 : 0) +
    (edited ? 22 : 0) +
    (recent ? 16 : 0) +
    Math.min(24, references * 6) +
    (importantName ? 18 : 0)

  return {
    path,
    name: basename(path),
    extension: ext(path),
    gitStatus,
    recentlyEdited: edited,
    referenceCount: references,
    importanceScore: Math.min(100, score),
    favorite: store.favorites.includes(path),
    pinned: store.pins.includes(path),
    summary: store.summaries[path] ?? store.summaries[relative] ?? (score >= 18 ? summaryFor(path) : undefined),
  } satisfies FileInsight
}

export function getFileInsights(nodes: FileNode[], workspace?: WorkspaceAwarenessSnapshot | null) {
  return flatten(nodes)
    .filter((node) => !node.isDir)
    .map((node) => getFileInsight(node.path, workspace))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importanceScore - a.importanceScore)
}

export function ensureBackgroundSummaries(nodes: FileNode[], workspace?: WorkspaceAwarenessSnapshot | null) {
  const store = readStore()
  const top = getFileInsights(nodes, workspace).slice(0, 12)
  let changed = false
  for (const insight of top) {
    if (!store.summaries[insight.path]) {
      store.summaries[insight.path] = summaryFor(insight.path, 'background')
      changed = true
    }
  }
  if (changed) writeStore(store)
}
