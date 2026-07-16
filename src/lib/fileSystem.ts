import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime'
import type { ProjectSearchResult } from '../types/nebula'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

type RawFileNode = Partial<FileNode> & {
  is_dir?: boolean
  children?: RawFileNode[]
}

function normalizeFileNode(node: RawFileNode): FileNode | null {
  if (typeof node?.name !== 'string' || typeof node?.path !== 'string') return null

  const isDir = typeof node.isDir === 'boolean' ? node.isDir : Boolean(node.is_dir)
  const children = Array.isArray(node.children)
    ? node.children.flatMap((child) => {
        const normalized = normalizeFileNode(child)
        return normalized ? [normalized] : []
      })
    : undefined

  return {
    name: node.name,
    path: node.path,
    isDir,
    children,
  }
}

function normalizeFileNodes(nodes: unknown): FileNode[] {
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((node) => {
    const normalized = normalizeFileNode(node as RawFileNode)
    return normalized ? [normalized] : []
  })
}

export async function pickProjectFolder() {
  if (!isTauriRuntime()) return null
  return invoke<string | null>('pick_project_folder')
}

export async function listFiles(path: string) {
  if (!isTauriRuntime() || !path) return []
  const nodes = await invoke<unknown>('list_files', { path })
  return normalizeFileNodes(nodes)
}

export async function readFile(path: string) {
  if (!isTauriRuntime()) throw new Error('File reading is available in the Tauri desktop app.')
  return invoke<string>('read_file', { path })
}

export async function writeFile(path: string, content: string) {
  if (!isTauriRuntime()) throw new Error('File writing is available in the Tauri desktop app.')
  await invoke('write_file', { path, content })
}

export async function createFile(path: string, content: string) {
  if (!isTauriRuntime()) throw new Error('File creation is available in the Tauri desktop app.')
  await invoke('create_file', { path, content })
}

export async function appendFile(path: string, content: string) {
  if (!isTauriRuntime()) throw new Error('File appending is available in the Tauri desktop app.')
  await invoke('append_file', { path, content })
}

export async function searchProjectFiles(path: string, query: string, maxResults = 80): Promise<ProjectSearchResult[]> {
  if (!isTauriRuntime()) throw new Error('Project content search is available in the Tauri desktop app.')
  if (!path.trim() || !query.trim()) return []
  const results = await invoke<unknown>('search_project_files', {
    path,
    query: query.trim(),
    maxResults: Math.max(1, Math.min(200, Math.round(maxResults))),
  })
  if (!Array.isArray(results)) return []
  return results.flatMap((result) => {
    if (!result || typeof result !== 'object') return []
    const candidate = result as Partial<ProjectSearchResult>
    if (typeof candidate.path !== 'string' || typeof candidate.line !== 'number' || typeof candidate.text !== 'string') return []
    return [{
      path: candidate.path,
      line: candidate.line,
      text: candidate.text,
      matchCount: typeof candidate.matchCount === 'number' ? candidate.matchCount : undefined,
    }]
  })
}
