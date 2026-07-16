import type { AppSettings } from '../types/settings'
import type { LauncherItem } from '../types/nebula'
import { listFiles, type FileNode } from './fileSystem'
import { openApp, openPathInExplorer } from './commandRunner'
import { getQuickActions } from './quickActions'

const knownApps = [
  ['Notepad', 'notepad', 'Open Notepad'],
  ['Calculator', 'calculator', 'Open Calculator'],
  ['Command Prompt', 'cmd', 'Open cmd.exe'],
  ['PowerShell', 'powershell', 'Open PowerShell'],
  ['Explorer', 'explorer', 'Open File Explorer'],
]

function flattenFiles(nodes: FileNode[], limit = 250): LauncherItem[] {
  const items: LauncherItem[] = []
  function walk(nodeList: FileNode[]) {
    for (const node of nodeList) {
      if (items.length >= limit) return
      if (node.isDir) {
        walk(node.children ?? [])
      } else {
        items.push({
          id: `file:${node.path}`,
          label: node.name,
          description: node.path,
          kind: 'file',
          value: node.path,
        })
      }
    }
  }
  walk(nodes)
  return items
}

export async function buildLauncherIndex(settings: AppSettings): Promise<LauncherItem[]> {
  const actions: LauncherItem[] = [
    { id: 'action:jarvis', label: 'Open Nebula Core', description: 'Diagnostics HUD, agent activity, automation routines, and Memory Core', kind: 'action', value: 'jarvis' },
    { id: 'action:models', label: 'Open Models', description: 'Review LM Studio models', kind: 'action', value: 'models' },
    { id: 'action:model-doctor', label: 'Open Model Doctor', description: 'Diagnose LM Studio and model loading issues', kind: 'action', value: 'modelDoctor' },
    { id: 'action:model-profiler', label: 'Open Model Profiler', description: 'Measure daily, code, and review model speed', kind: 'action', value: 'modelProfiler' },
    { id: 'action:permissions', label: 'Open Permission Center', description: 'Control local capabilities and safety modes', kind: 'action', value: 'permissions' },
    { id: 'action:setup', label: 'Run Setup Wizard', description: 'Check LM Studio, models, workspace, memory, and permissions', kind: 'action', value: 'setup' },
    { id: 'action:training', label: 'Open Training Logs', description: 'Export local examples for future fine-tuning', kind: 'action', value: 'training' },
    { id: 'action:fine-tuning', label: 'Open Fine-Tuning Lab', description: 'Audit and export a redacted QLoRA train/validation split', kind: 'action', value: 'fineTuning' },
    { id: 'action:context', label: 'Open Context Inspector', description: 'Inspect the latest memory and workspace context bundle', kind: 'action', value: 'context' },
    { id: 'action:privacy', label: 'Open Privacy Dashboard', description: 'See local folders, provider destination, skills, and enabled access', kind: 'action', value: 'privacy' },
    { id: 'action:memory', label: 'Open Memory Inbox', description: 'Review proposed memories', kind: 'action', value: 'memory' },
    { id: 'action:settings', label: 'Open Settings', description: 'Configure Nebula', kind: 'action', value: 'settings' },
    { id: 'action:screenshot', label: 'Capture Screen', description: 'Give Nebula current screen context', kind: 'action', value: 'capture_screen' },
    { id: 'action:screenshot_ask', label: 'Ask About This Screen', description: 'Capture screen context and open the ambient prompt', kind: 'action', value: 'screenshot_ask' },
    ...getQuickActions().map((action) => ({
      id: `quick:${action.id}`,
      label: action.label,
      description: action.description,
      kind: 'action' as const,
      value: action.id,
    })),
  ]
  const appItems = knownApps.map(([label, value, description]) => ({ id: `app:${value}`, label, description, kind: 'app' as const, value }))
  const folders = [settings.projectFolder, ...(settings.launcherIndexedFolders ?? [])].filter(Boolean)
  const projectItems = folders.map((folder) => ({
    id: `project:${folder}`,
    label: folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder,
    description: folder,
    kind: 'project' as const,
    value: folder,
  }))
  const fileGroups = await Promise.all(
    folders.map((folder) => listFiles(folder).then((nodes) => flattenFiles(nodes)).catch(() => [])),
  )
  return [...actions, ...appItems, ...projectItems, ...fileGroups.flat()]
}

export function searchLauncherItems(items: LauncherItem[], query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return items.slice(0, 60)
  return items
    .map((item) => ({
      item,
      score: terms.reduce((score, term) => {
        const label = item.label.toLowerCase()
        const haystack = `${item.description} ${item.kind}`.toLowerCase()
        return score + (label.startsWith(term) ? 5 : label.includes(term) ? 3 : haystack.includes(term) ? 1 : 0)
      }, 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item)
    .slice(0, 60)
}

export async function launchItem(item: LauncherItem) {
  if (item.kind === 'app') {
    await openApp(item.value)
    return `Opened ${item.label}.`
  }
  if (item.kind === 'project' || item.kind === 'file') {
    await openPathInExplorer(item.value)
    return `${item.kind === 'project' ? 'Project opened' : 'File selected'}: ${item.value}`
  }
  return `Action selected: ${item.value}`
}
