import { isTauriRuntime } from './runtime'

export const AMBIENT_SHORTCUT = 'CommandOrControl+Space'

type Cleanup = () => void | Promise<void>

export async function registerAmbientShortcut(holdMs: number, onTrigger: () => void): Promise<Cleanup> {
  if (!isTauriRuntime()) return () => undefined

  const { isRegistered, register, unregister } = await import('@tauri-apps/plugin-global-shortcut')
  const shortcut = AMBIENT_SHORTCUT
  let holdTimer: number | null = null
  let firedAt = 0

  const clearHold = () => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  if (await isRegistered(shortcut).catch(() => false)) {
    await unregister(shortcut).catch(() => undefined)
  }

  await register(shortcut, (event) => {
    const state = event?.state

    if (state === 'Released') {
      clearHold()
      return
    }

    if (state && state !== 'Pressed') return
    clearHold()

    holdTimer = window.setTimeout(() => {
      const now = Date.now()
      if (now - firedAt < 650) return
      firedAt = now
      onTrigger()
    }, Math.max(0, holdMs || 0))
  })

  return async () => {
    clearHold()
    await unregister(shortcut).catch(() => undefined)
  }
}

export async function setLaunchAtStartup(enabled: boolean) {
  if (!isTauriRuntime()) return false

  const autostart = await import('@tauri-apps/plugin-autostart')
  const current = await autostart.isEnabled().catch(() => false)

  if (enabled && !current) {
    await autostart.enable()
  }

  if (!enabled && current) {
    await autostart.disable()
  }

  return autostart.isEnabled().catch(() => enabled)
}

export async function showMainWindow() {
  if (!isTauriRuntime()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  await appWindow.show().catch(() => undefined)
  await appWindow.setFocus().catch(() => undefined)
}

export async function openAmbientOverlay() {
  if (!isTauriRuntime()) return false

  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = 'ambient-overlay'
  const existing = await WebviewWindow.getByLabel(label).catch(() => null)

  const reveal = async (overlay: InstanceType<typeof WebviewWindow>) => {
    await overlay.show()
    await overlay.setAlwaysOnTop(true)
    await overlay.setFullscreen(true)
    await overlay.setFocus()
  }

  if (existing) {
    await reveal(existing)
    const { emit } = await import('@tauri-apps/api/event')
    await emit('ambient-open').catch(() => undefined)
    return true
  }

  const overlay = new WebviewWindow(label, {
    url: '/?overlay=ambient',
    title: 'Nebula Ambient',
    fullscreen: true,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    shadow: false,
    focus: true,
    visible: false,
  })

  await new Promise<void>((resolve, reject) => {
    overlay.once('tauri://created', () => resolve())
    overlay.once('tauri://error', (event) => reject(event.payload))
  })
  await reveal(overlay)

  const { emit } = await import('@tauri-apps/api/event')
  await emit('ambient-open').catch(() => undefined)

  return true
}

export async function registerBackgroundClose(enabled: boolean, onHidden: () => void): Promise<Cleanup> {
  if (!isTauriRuntime()) return () => undefined

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()

  return appWindow.onCloseRequested(async (event) => {
    if (!enabled) return
    event.preventDefault()
    await appWindow.hide().catch(() => undefined)
    onHidden()
  })
}
