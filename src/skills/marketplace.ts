import type { MarketplaceItem, SkillDefinition } from './types'

const MARKETPLACE_INSTALLS_KEY = 'nebula-marketplace-installs'

export const MARKETPLACE_ITEMS: MarketplaceItem[] = [
  {
    id: 'research-companion',
    kind: 'skill',
    name: 'Research Companion',
    description: 'Adds a cautious research workflow using memory first, then web search/fetch with source notes.',
    author: 'Nebula Labs',
    version: '0.1.0',
    category: 'Research',
    tags: ['web', 'memory', 'sources'],
    featured: true,
    installedSkill: {
      id: 'marketplace-research-companion',
      name: 'Research Companion',
      description: 'Searches memory before web, fetches pages safely, and records useful verified findings with source URLs.',
      enabled: true,
      requiredPermissions: ['read:memory', 'write:memory', 'network:web-search', 'network:web-fetch'],
      riskLevel: 'needs_approval',
      tools: [
        {
          name: 'search_memory',
          description: 'Search local memory before web research.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Search query.' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
        {
          name: 'web_search',
          description: 'Search the web for current or external information.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query.' },
              maxResults: { type: 'number', description: 'Maximum results to return.' },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
        {
          name: 'web_fetch',
          description: 'Fetch safe text content from a public webpage.',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Public http(s) URL.' } },
            required: ['url'],
            additionalProperties: false,
          },
        },
        {
          name: 'write_memory',
          description: 'Save durable verified research notes.',
          parameters: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'Memory file name.' },
              content: { type: 'string', description: 'Markdown note with source URL and date checked.' },
            },
            required: ['file', 'content'],
            additionalProperties: false,
          },
        },
      ],
      systemPromptAdditions: [
        'Research Companion: search memory first. Use web only when current/external facts are needed. Store durable verified findings with source URL and date checked.',
      ],
      examples: ['Research current LM Studio setup docs and save the useful bits.', 'Check memory before searching the web.'],
      source: 'marketplace',
      author: 'Nebula Labs',
      version: '0.1.0',
      tags: ['web', 'memory', 'sources'],
    },
  },
  {
    id: 'code-workbench',
    kind: 'plugin',
    name: 'Code Workbench',
    description: 'A coding-focused pack for reading files, proposing diffs, running tests, and reviewing output.',
    author: 'Nebula Labs',
    version: '0.1.0',
    category: 'Development',
    tags: ['code', 'files', 'terminal'],
    featured: true,
    installedSkill: {
      id: 'marketplace-code-workbench',
      name: 'Code Workbench',
      description: 'Combines file reading and project-local command execution for code tasks.',
      enabled: true,
      requiredPermissions: ['read:project-files', 'write:project-files', 'run:project-command'],
      riskLevel: 'high_risk',
      tools: [
        {
          name: 'list_files',
          description: 'List project files.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Folder path.' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
        {
          name: 'read_file',
          description: 'Read a project file before editing.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'File path.' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
        {
          name: 'write_file',
          description: 'Write a file after producing a diff and safety check.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path.' },
              content: { type: 'string', description: 'New file content.' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
        {
          name: 'run_command',
          description: 'Run project-local verification commands.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to run.' },
              cwd: { type: 'string', description: 'Optional working directory.' },
            },
            required: ['command'],
            additionalProperties: false,
          },
        },
      ],
      systemPromptAdditions: [
        'Code Workbench: read before editing, keep changes scoped, prefer diffs, and verify with tests/build commands when available.',
      ],
      examples: ['Read package.json and explain the app.', 'Make a small fix and run npm test or npm run build.'],
      source: 'marketplace',
      author: 'Nebula Labs',
      version: '0.1.0',
      tags: ['code', 'files', 'terminal'],
    },
  },
  {
    id: 'windows-sidekick',
    kind: 'skill',
    name: 'Windows Sidekick',
    description: 'Safe desktop helper pack for known apps, screenshots, current time, and system info.',
    author: 'Nebula Labs',
    version: '0.1.0',
    category: 'Windows',
    tags: ['desktop', 'screen', 'apps'],
    installedSkill: {
      id: 'marketplace-windows-sidekick',
      name: 'Windows Sidekick',
      description: 'Uses safe local PC helper tools without inventing shell commands.',
      enabled: true,
      requiredPermissions: ['screen:capture', 'control:known-apps', 'read:system-info'],
      riskLevel: 'needs_approval',
      tools: [
        {
          name: 'capture_screen',
          description: 'Capture the current screen for local context.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'open_app',
          description: 'Open a known safe app by name.',
          parameters: {
            type: 'object',
            properties: { app: { type: 'string', description: 'Known app name.' } },
            required: ['app'],
            additionalProperties: false,
          },
        },
        {
          name: 'get_current_time',
          description: 'Read the current local time.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'get_system_info',
          description: 'Read basic local system information.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      systemPromptAdditions: [
        'Windows Sidekick: use dedicated PC tools instead of arbitrary shell commands for screenshots, app opening, time, and system info.',
      ],
      examples: ['Take a screen capture and describe what is visible.', 'Open calculator.'],
      source: 'marketplace',
      author: 'Nebula Labs',
      version: '0.1.0',
      tags: ['desktop', 'screen', 'apps'],
    },
  },
  {
    id: 'memory-coach',
    kind: 'skill',
    name: 'Memory Coach',
    description: 'Improves how Nebula decides what is worth remembering and how to summarize old notes.',
    author: 'Nebula Labs',
    version: '0.1.0',
    category: 'Memory',
    tags: ['memory', 'preferences', 'lessons'],
    installedSkill: {
      id: 'marketplace-memory-coach',
      name: 'Memory Coach',
      description: 'Adds stricter rules for durable memory hygiene.',
      enabled: true,
      requiredPermissions: ['read:memory', 'write:memory'],
      riskLevel: 'needs_approval',
      tools: [
        {
          name: 'search_memory',
          description: 'Search local memory for relevant durable notes.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Search query.' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
        {
          name: 'write_memory',
          description: 'Write useful durable lessons, preferences, or fixes.',
          parameters: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'Memory file name.' },
              content: { type: 'string', description: 'Markdown content.' },
            },
            required: ['file', 'content'],
            additionalProperties: false,
          },
        },
      ],
      systemPromptAdditions: [
        'Memory Coach: remember durable user preferences, repeated fixes, and reusable lessons. Do not save secrets, random chat, or temporary state.',
      ],
      examples: ['Save that the user prefers fast local model routing.', 'Do not save one-off debug noise.'],
      source: 'marketplace',
      author: 'Nebula Labs',
      version: '0.1.0',
      tags: ['memory', 'preferences', 'lessons'],
    },
  },
]

export function loadMarketplaceInstalls(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(MARKETPLACE_INSTALLS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function saveMarketplaceInstalls(installs: Record<string, boolean>) {
  try {
    localStorage.setItem(MARKETPLACE_INSTALLS_KEY, JSON.stringify(installs))
  } catch {
    // Marketplace installs can be restored from defaults if persistence fails.
  }
}

export function installMarketplaceItem(itemId: string) {
  const installs = loadMarketplaceInstalls()
  const next = { ...installs, [itemId]: true }
  saveMarketplaceInstalls(next)
  return next
}

export function uninstallMarketplaceItem(itemId: string) {
  const installs = loadMarketplaceInstalls()
  const next = { ...installs, [itemId]: false }
  saveMarketplaceInstalls(next)
  return next
}

export function isMarketplaceItemInstalled(itemId: string) {
  return loadMarketplaceInstalls()[itemId] === true
}

export function getMarketplaceItems() {
  const installs = loadMarketplaceInstalls()
  return MARKETPLACE_ITEMS.map((item) => ({ ...item, installed: installs[item.id] === true }))
}

export function getInstalledMarketplaceSkills(): SkillDefinition[] {
  const installs = loadMarketplaceInstalls()
  return MARKETPLACE_ITEMS.filter((item) => installs[item.id] === true).map((item) => item.installedSkill)
}
