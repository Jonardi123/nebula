import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime'

export interface CommandOutput {
  code: number | null
  stdout: string
  stderr: string
}

export async function runCommand(command: string, cwd: string) {
  if (!isTauriRuntime()) {
    return { code: null, stdout: '', stderr: `Command "${command}" requires the Tauri desktop app. cwd=${cwd}` }
  }
  return invoke<CommandOutput>('run_command', { command, cwd })
}

export async function stopRunningCommand() {
  if (!isTauriRuntime()) return
  return invoke('stop_running_command')
}

export async function getSystemInfo() {
  if (!isTauriRuntime()) return `Browser preview\n${navigator.userAgent}`
  return invoke<string>('get_system_info')
}

export async function sleepPc() {
  if (!isTauriRuntime()) throw new Error('sleep_pc requires the Tauri desktop app.')
  return invoke('sleep_pc')
}

export async function openApp(app: string) {
  if (!isTauriRuntime()) throw new Error(`open_app(${app}) requires the Tauri desktop app.`)
  return invoke('open_app', { app })
}

export async function openPathInExplorer(path: string) {
  if (!isTauriRuntime()) throw new Error(`open_path_in_explorer(${path}) requires the Tauri desktop app.`)
  return invoke('open_path_in_explorer', { path })
}
