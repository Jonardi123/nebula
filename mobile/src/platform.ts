import { Capacitor, registerPlugin } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { deletePrivateValue, readPrivateValue, writePrivateValue } from './idb'

const SecureStorage = registerPlugin<{ get(options: { key: string }): Promise<{ value: string | null }>; set(options: { key: string; value: string }): Promise<void>; remove(options: { key: string }): Promise<void> }>('NebulaSecureStorage')

export const isNativeMobile = Capacitor.isNativePlatform()

export function apiUrl(path: string, bridgeUrl: string) {
  if (!isNativeMobile) return path
  return new URL(path, `${bridgeUrl.replace(/\/$/, '')}/`).toString()
}

export async function readPreference(key: string) {
  if (isNativeMobile) return (await Preferences.get({ key })).value
  return localStorage.getItem(`nebula-${key}`)
}

export async function writePreference(key: string, value: string) {
  if (isNativeMobile) await Preferences.set({ key, value })
  else localStorage.setItem(`nebula-${key}`, value)
}

export async function readSecureValue<T>(key: string): Promise<T | null> {
  if (!isNativeMobile) return readPrivateValue<T>(key)
  const result = await SecureStorage.get({ key })
  if (!result.value) return null
  try { return JSON.parse(result.value) as T } catch { return null }
}

export async function writeSecureValue(key: string, value: unknown) {
  if (!isNativeMobile) return writePrivateValue(key, value)
  await SecureStorage.set({ key, value: JSON.stringify(value) })
}

export async function deleteSecureValue(key: string) {
  if (!isNativeMobile) return deletePrivateValue(key)
  await SecureStorage.remove({ key })
}

export async function impact(enabled: boolean, style: 'light' | 'medium' = 'light') {
  if (!enabled || !isNativeMobile) return
  await Haptics.impact({ style: style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => undefined)
}

export async function notifyHaptic(enabled: boolean, success: boolean) {
  if (!enabled || !isNativeMobile) return
  await Haptics.notification({ type: success ? NotificationType.Success : NotificationType.Error }).catch(() => undefined)
}

export async function shareValue(value: string) {
  if (isNativeMobile) { await Share.share({ text: value, dialogTitle: 'Share from Nebula' }); return }
  if (navigator.share) { await navigator.share({ text: value }); return }
  await navigator.clipboard.writeText(value)
}

export async function openPublicSource(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Nebula only opens secure public source links.')
  if (isNativeMobile) { await Browser.open({ url: url.href }); return }
  window.open(url.href, '_blank', 'noopener,noreferrer')
}

export async function initializeNativeRuntime() {
  if (!isNativeMobile) return
  await Promise.allSettled([
    Keyboard.setResizeMode({ mode: KeyboardResize.Native }),
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setOverlaysWebView({ overlay: true }),
    SplashScreen.hide(),
  ])
}

export async function showCompletionNotification(enabled: boolean, title: string) {
  if (!enabled || !isNativeMobile) return
  const permission = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' as const }))
  const allowed = permission.display === 'granted'
    ? permission
    : await LocalNotifications.requestPermissions().catch(() => ({ display: 'denied' as const }))
  if (allowed.display !== 'granted') return
  await LocalNotifications.schedule({
    notifications: [{ id: Math.floor(Date.now() % 2_000_000_000), title: 'Nebula finished', body: title.slice(0, 120) || 'Your response is ready.' }],
  }).catch(() => undefined)
}
