import { invoke } from '@tauri-apps/api/core'
import type { ResourceSnapshot } from '../types/nebula'
import { approxJsHeapMb } from './modelStats'
import { isTauriRuntime } from './runtime'

function normalizeNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export async function getResourceSnapshot(): Promise<ResourceSnapshot> {
  const checkedAt = new Date().toISOString()
  const jsHeapMb = approxJsHeapMb()

  if (!isTauriRuntime()) {
    return {
      checkedAt,
      jsHeapMb,
      vramNote: 'Native resource diagnostics require the Tauri desktop app.',
    }
  }

  try {
    const raw = await invoke<string>('get_resource_snapshot')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      checkedAt: String(parsed.checkedAt ?? checkedAt),
      cpuLoadPercent: normalizeNumber(parsed.cpuLoadPercent),
      ramTotalMb: normalizeNumber(parsed.ramTotalMb),
      ramAvailableMb: normalizeNumber(parsed.ramAvailableMb),
      processWorkingSetMb: normalizeNumber(parsed.processWorkingSetMb),
      systemDrive: typeof parsed.systemDrive === 'string' ? parsed.systemDrive : undefined,
      systemDriveTotalMb: normalizeNumber(parsed.systemDriveTotalMb),
      systemDriveFreeMb: normalizeNumber(parsed.systemDriveFreeMb),
      gpuName: typeof parsed.gpuName === 'string' ? parsed.gpuName : undefined,
      vramTotalMb: normalizeNumber(parsed.vramTotalMb),
      vramNote: typeof parsed.vramNote === 'string' ? parsed.vramNote : undefined,
      jsHeapMb,
    }
  } catch (error) {
    return {
      checkedAt,
      jsHeapMb,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
