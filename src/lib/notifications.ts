import { invoke } from '@tauri-apps/api/core'
import type { NebulaNotification } from '../types/nebula'
import { isTauriRuntime } from './runtime'
import { writeLocalJson } from './safeStorage'

const NOTIFICATIONS_KEY = 'nebula-notifications'

function readNotifications() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) ?? '[]') as NebulaNotification[]
  } catch {
    return []
  }
}

function writeNotifications(items: NebulaNotification[]) {
  try {
    writeLocalJson(NOTIFICATIONS_KEY, items.slice(0, 120))
  } catch {
    // Notifications are best-effort UI state.
  }
}

export function getNotifications() {
  return readNotifications()
}

export function getUnreadNotificationCount() {
  return readNotifications().filter((item) => !item.read).length
}

export async function notify(update: Omit<NebulaNotification, 'id' | 'read' | 'createdAt'>) {
  const notification: NebulaNotification = {
    id: crypto.randomUUID(),
    read: false,
    createdAt: new Date().toISOString(),
    ...update,
  }
  writeNotifications([notification, ...readNotifications()])

  if (isTauriRuntime()) {
    await invoke('show_tray_notification', {
      title: notification.title,
      body: notification.message,
    }).catch(() => undefined)
  }

  window.dispatchEvent(new CustomEvent('nebula-notifications-changed'))
  return notification
}

export function markNotificationsRead() {
  writeNotifications(readNotifications().map((item) => ({ ...item, read: true })))
  window.dispatchEvent(new CustomEvent('nebula-notifications-changed'))
}

export function clearNotifications() {
  writeNotifications([])
  window.dispatchEvent(new CustomEvent('nebula-notifications-changed'))
}
