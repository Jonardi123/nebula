import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime'

export interface ScreenCaptureResult {
  path: string
  width: number
  height: number
  createdAt: string
}

export async function captureScreen() {
  if (!isTauriRuntime()) {
    return {
      path: 'Browser preview only: screen capture is available in the Tauri desktop app.',
      width: 0,
      height: 0,
      createdAt: new Date().toISOString(),
    }
  }

  return invoke<ScreenCaptureResult>('capture_screen')
}
