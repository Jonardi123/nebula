import type { ProjectProfile } from '../types/nebula'
import { writeLocalJson } from './safeStorage'
import type { AppSettings } from '../types/settings'
import { readFile } from './fileSystem'

const PROJECT_PROFILES_KEY = 'nebula-project-profiles'

function readProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_PROFILES_KEY) ?? '[]') as ProjectProfile[]
  } catch {
    return []
  }
}

function writeProfiles(profiles: ProjectProfile[]) {
  try {
    writeLocalJson(PROJECT_PROFILES_KEY, profiles.slice(0, 80))
  } catch {
    // Project profiles are recoverable from project metadata.
  }
}

function joinPath(folder: string, file: string) {
  return `${folder.replace(/[\\/]+$/, '')}\\${file.replace(/^[\\/]+/, '')}`
}

function projectName(folder: string) {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
}

async function tryRead(folder: string, file: string) {
  try {
    return await readFile(joinPath(folder, file))
  } catch {
    return ''
  }
}

function detectPackageManager(files: Record<string, string>) {
  if ('pnpm-lock.yaml' in files) return 'pnpm'
  if ('yarn.lock' in files) return 'yarn'
  if ('package-lock.json' in files) return 'npm'
  if ('bun.lockb' in files || 'bun.lock' in files) return 'bun'
  return files['package.json'] ? 'npm' : 'unknown'
}

function detectFramework(packageJson: any, files: Record<string, string>) {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  }
  const names = Object.keys(deps)
  const has = (name: string) => names.includes(name)
  const frameworks: string[] = []

  if (has('@tauri-apps/api') || files['src-tauri/tauri.conf.json']) frameworks.push('Tauri')
  if (has('react')) frameworks.push('React')
  if (has('vite')) frameworks.push('Vite')
  if (has('next')) frameworks.push('Next.js')
  if (has('typescript')) frameworks.push('TypeScript')
  if (has('tailwindcss') || has('@tailwindcss/vite')) frameworks.push('Tailwind CSS')
  if (has('electron')) frameworks.push('Electron')

  return frameworks.length > 0 ? frameworks.join(' + ') : packageJson ? 'Node app' : 'Unknown project'
}

function summarize(packageJson: any, readme: string, framework: string, packageManager: string, scripts: string[]) {
  const packageName = packageJson?.name ? String(packageJson.name) : 'project'
  const readmeLine = readme
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)

  const scriptText = scripts.length ? ` Common scripts: ${scripts.slice(0, 6).join(', ')}.` : ''
  return `${packageName} appears to be a ${framework} using ${packageManager}.${readmeLine ? ` README: ${readmeLine}.` : ''}${scriptText}`
}

export function getProjectProfiles() {
  return readProfiles()
}

export function getProjectProfile(id: string) {
  if (!id) return null
  return readProfiles().find((profile) => profile.id === id) ?? null
}

export function getProfileByFolder(folder: string) {
  return readProfiles().find((profile) => profile.folder.toLowerCase() === folder.toLowerCase()) ?? null
}

export function saveProjectProfile(profile: ProjectProfile) {
  const profiles = readProfiles()
  const next = [
    {
      ...profile,
      updatedAt: new Date().toISOString(),
    },
    ...profiles.filter((item) => item.id !== profile.id),
  ]
  writeProfiles(next)
  return next[0]
}

export async function detectProjectProfile(folder: string, settings: AppSettings) {
  const now = new Date().toISOString()
  const previous = getProfileByFolder(folder)
  const fileNames = [
    'package.json',
    'README.md',
    'readme.md',
    'src-tauri/tauri.conf.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ]
  const pairs = await Promise.all(fileNames.map(async (file) => [file, await tryRead(folder, file)] as const))
  const files = Object.fromEntries(pairs.filter(([, content]) => content)) as Record<string, string>
  let packageJson: any = null

  if (files['package.json']) {
    try {
      packageJson = JSON.parse(files['package.json'])
    } catch {
      packageJson = null
    }
  }

  const framework = detectFramework(packageJson, files)
  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts) : []
  const packageManager = detectPackageManager(files)
  const readme = files['README.md'] || files['readme.md'] || ''
  const detectedProfile: ProjectProfile = {
    id: previous?.id ?? crypto.randomUUID(),
    folder,
    name: previous?.name || projectName(folder),
    detectedFramework: framework,
    packageManager,
    commonScripts: scripts,
    preferredModels: previous?.preferredModels ?? {
      daily: settings.modelAssignments?.daily || settings.fastModel,
      code: settings.modelAssignments?.code || settings.codeModel,
      review: settings.modelAssignments?.review || settings.reviewModel,
    },
    ignoredFolders: previous?.ignoredFolders ?? ['node_modules', '.git', 'dist', 'target'],
    summary: previous?.summary || summarize(packageJson, readme, framework, packageManager, scripts),
    notes: previous?.notes ?? '',
    metadataFiles: Object.keys(files),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }

  return saveProjectProfile(detectedProfile)
}

export function formatProjectProfileForPrompt(profile: ProjectProfile | null) {
  if (!profile) return 'No active project profile.'
  return [
    `Active project profile: ${profile.name}`,
    `Folder: ${profile.folder}`,
    `Framework: ${profile.detectedFramework}`,
    `Package manager: ${profile.packageManager}`,
    `Scripts: ${profile.commonScripts.join(', ') || 'none detected'}`,
    `Ignored folders: ${profile.ignoredFolders.join(', ')}`,
    `Summary: ${profile.summary}`,
    profile.notes ? `Notes: ${profile.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
