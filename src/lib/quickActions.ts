import type { QuickAction, QuickActionRun } from '../types/nebula'

const RUNS_KEY = 'nebula-quick-action-runs'

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'find-bugs',
    label: 'Find Bugs',
    description: 'Inspect likely problem areas and report concrete bugs.',
    prompt: 'Find likely bugs in this project. Inspect relevant files first, prioritize concrete findings, and do not edit files unless I explicitly ask.',
    scope: 'workspace',
    risk: 'safe',
    preferredSkills: ['files', 'review'],
    taskMode: true,
  },
  {
    id: 'review-project',
    label: 'Review Project',
    description: 'Run a broad project review with architecture and maintainability notes.',
    prompt: 'Review this project. Use the active workspace context, inspect metadata and key files, then return concise findings with severity and recommended fixes. Do not edit files.',
    scope: 'workspace',
    risk: 'safe',
    preferredSkills: ['files', 'review'],
    taskMode: true,
  },
  {
    id: 'explain-current-file',
    label: 'Explain Current File',
    description: 'Explain what the selected file does.',
    prompt: 'Explain the current file clearly: purpose, important functions/components, dependencies, and any risks you notice. Do not edit it.',
    scope: 'file',
    risk: 'safe',
    preferredSkills: ['files', 'chat'],
    requiresFile: true,
  },
  {
    id: 'optimize-code',
    label: 'Optimize Code',
    description: 'Look for focused performance or readability improvements.',
    prompt: 'Review the selected code for optimization opportunities. Suggest minimal safe changes and explain tradeoffs. Do not edit until asked.',
    scope: 'file',
    risk: 'safe',
    preferredSkills: ['files', 'coding', 'review'],
    requiresFile: true,
  },
  {
    id: 'refactor-safely',
    label: 'Refactor Safely',
    description: 'Plan a low-risk refactor before editing.',
    prompt: 'Refactor safely: inspect the selected file or project area, identify the smallest useful refactor, and propose a patch plan. Do not edit until asked.',
    scope: 'file',
    risk: 'needs_confirmation',
    preferredSkills: ['files', 'coding', 'review'],
    requiresFile: true,
    taskMode: true,
  },
  {
    id: 'generate-commit-message',
    label: 'Generate Commit Message',
    description: 'Use git/project context to draft a commit message.',
    prompt: 'Generate a concise commit message from the current project changes. Use git status/diff only if available through tools, and do not modify files.',
    scope: 'workspace',
    risk: 'safe',
    preferredSkills: ['terminal', 'files'],
  },
  {
    id: 'summarize-readme',
    label: 'Summarize README',
    description: 'Summarize project README and key setup details.',
    prompt: 'Read and summarize the README for this project. Include purpose, setup, commands, and anything important for future work. Do not edit files.',
    scope: 'workspace',
    risk: 'safe',
    preferredSkills: ['files', 'memory'],
  },
  {
    id: 'search-project',
    label: 'Search Project',
    description: 'Search relevant project files for a topic.',
    prompt: 'Search this project for the relevant files and explain what you find. Ask a follow-up if the search topic is missing.',
    scope: 'workspace',
    risk: 'safe',
    preferredSkills: ['files', 'coding'],
  },
  {
    id: 'diagnose-models',
    label: 'Diagnose Models',
    description: 'Review local model health, latency, and routing behavior.',
    prompt: 'Diagnose Nebula model routing and LM Studio health using diagnostics and model stats. Explain what is slow or misconfigured and suggest safe changes.',
    scope: 'models',
    risk: 'safe',
    preferredSkills: ['diagnostics'],
  },
  {
    id: 'clear-temp-context',
    label: 'Clear Temporary Context',
    description: 'Clear transient session context without deleting memory or task history.',
    prompt: '',
    scope: 'session',
    risk: 'needs_confirmation',
    preferredSkills: [],
  },
]

function readRuns() {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]') as QuickActionRun[]
  } catch {
    return []
  }
}

function writeRuns(runs: QuickActionRun[]) {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, 160)))
    window.dispatchEvent(new CustomEvent('nebula-quick-actions-changed'))
  } catch {
    // Quick action history is best-effort.
  }
}

export function getQuickActions() {
  return QUICK_ACTIONS
}

export function getQuickAction(id: string) {
  return QUICK_ACTIONS.find((action) => action.id === id) ?? null
}

export function getQuickActionRuns() {
  return readRuns()
}

export function recordQuickActionRun(update: Omit<QuickActionRun, 'id' | 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString()
  const run: QuickActionRun = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...update,
  }
  writeRuns([run, ...readRuns()])
  return run
}

export function updateQuickActionRun(id: string, update: Partial<QuickActionRun>) {
  const runs = readRuns()
  const next = runs.map((run) => (run.id === id ? { ...run, ...update, updatedAt: new Date().toISOString() } : run))
  writeRuns(next)
  return next.find((run) => run.id === id) ?? null
}

export function promptForQuickAction(action: QuickAction, target?: string) {
  const targetText = target ? `\nTarget: ${target}` : ''
  if (action.scope === 'file') {
    return `[QUICK ACTION: ${action.label}]\n${action.prompt}${targetText}\nUse the selected target and current workspace context.`
  }
  return `[QUICK ACTION: ${action.label}]\n${action.prompt}${targetText}`
}

export function clearTemporaryContext() {
  localStorage.removeItem('nebula-transient-context')
  localStorage.removeItem('nebula-draft-context')
  window.dispatchEvent(new CustomEvent('nebula-temporary-context-cleared'))
}
