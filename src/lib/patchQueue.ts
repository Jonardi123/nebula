import type { PatchProposal } from '../types/nebula'
import type { RiskLevel, ToolName } from '../types/tools'
import { createFile, readFile, writeFile } from './fileSystem'
import { writeLocalJson } from './safeStorage'

const PATCH_QUEUE_KEY = 'nebula-patch-proposals'
const MAX_PATCH_CONTENT_CHARS = 250000
const SENSITIVE_PATH_PATTERN = /(^|[\\/])(\.env(\.|$)|id_rsa|id_dsa|credentials|secrets?|tokens?|private[-_]?key)|\.(pem|pfx|p12|key)$/i

function nowIso() {
  return new Date().toISOString()
}

function readQueue() {
  try {
    const raw = localStorage.getItem(PATCH_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PatchProposal[]) : []
  } catch {
    return []
  }
}

function writeQueue(items: PatchProposal[]) {
  try {
    writeLocalJson(PATCH_QUEUE_KEY, items.slice(0, 120))
    window.dispatchEvent(new CustomEvent('nebula-patch-queue-changed'))
  } catch {
    // Patch proposals are useful state, but should not crash tool execution.
  }
}

function operationFromTool(tool: ToolName): PatchProposal['operation'] {
  if (tool === 'create_file') return 'create'
  if (tool === 'append_file') return 'append'
  return 'write'
}

async function tryReadFile(path: string) {
  try {
    return { exists: true, content: await readFile(path) }
  } catch {
    return { exists: false, content: '' }
  }
}

export function getPatchProposals() {
  return readQueue()
}

export function getPendingPatchCount() {
  return readQueue().filter((proposal) => proposal.status === 'pending').length
}

export async function queuePatchFromTool(
  tool: ToolName,
  path: string,
  content: string,
  options: { reason?: string; riskLevel?: RiskLevel } = {},
) {
  if (!['write_file', 'create_file', 'append_file'].includes(tool)) {
    throw new Error(`Tool ${tool} cannot create a patch proposal.`)
  }

  const operation = operationFromTool(tool)
  if (SENSITIVE_PATH_PATTERN.test(path)) {
    throw new Error(`Patch queue refuses to store secret-like file contents: ${path}`)
  }

  const current = await tryReadFile(path)
  if (operation === 'create' && current.exists) {
    throw new Error(`File already exists: ${path}`)
  }

  const oldContent = current.content
  const newContent = operation === 'append' ? `${oldContent}${content}` : content
  if (oldContent.length + newContent.length > MAX_PATCH_CONTENT_CHARS) {
    throw new Error('Patch is too large for the preview queue. Split the edit into smaller changes.')
  }

  const proposal: PatchProposal = {
    id: crypto.randomUUID(),
    path,
    operation,
    sourceTool: tool,
    status: 'pending',
    riskLevel: options.riskLevel ?? 'needs_approval',
    reason: options.reason ?? `${tool} requested by Nebula. Review and apply from the Patch Queue.`,
    oldContent,
    newContent,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  writeQueue([proposal, ...readQueue()])
  return proposal
}

function updatePatch(id: string, update: Partial<PatchProposal>) {
  const next = readQueue().map((proposal) =>
    proposal.id === id
      ? {
          ...proposal,
          ...update,
          updatedAt: nowIso(),
        }
      : proposal,
  )
  writeQueue(next)
  return next.find((proposal) => proposal.id === id) ?? null
}

export async function applyPatchProposal(id: string) {
  const proposal = readQueue().find((item) => item.id === id)
  if (!proposal) throw new Error('Patch proposal not found.')
  if (proposal.status !== 'pending' && proposal.status !== 'error') {
    throw new Error(`Patch is already ${proposal.status}.`)
  }

  try {
    if (proposal.operation === 'create') {
      await createFile(proposal.path, proposal.newContent)
    } else {
      await writeFile(proposal.path, proposal.newContent)
    }
    return updatePatch(id, { status: 'applied', appliedAt: nowIso(), error: undefined })
  } catch (error) {
    updatePatch(id, { status: 'error', error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export function rejectPatchProposal(id: string) {
  return updatePatch(id, { status: 'rejected' })
}

export async function applyPatchProposals(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids))
  const selected = readQueue().filter((proposal) => uniqueIds.includes(proposal.id))
  const duplicatePath = selected.find((proposal, index) => selected.findIndex((item) => item.path.toLowerCase() === proposal.path.toLowerCase()) !== index)
  if (duplicatePath) throw new Error(`Apply patches for ${duplicatePath.path} one at a time so their base content stays valid.`)
  const applied: PatchProposal[] = []
  for (const id of uniqueIds) {
    const result = await applyPatchProposal(id)
    if (result) applied.push(result)
  }
  return applied
}

export function rejectPatchProposals(ids: string[]) {
  return Array.from(new Set(ids)).map((id) => rejectPatchProposal(id)).filter(Boolean)
}

export function clearResolvedPatches() {
  writeQueue(readQueue().filter((proposal) => proposal.status === 'pending' || proposal.status === 'error'))
}
