import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearNotifications, getNotifications, markNotificationsRead } from '../lib/notifications'
import type { NebulaNotification } from '../types/nebula'

export function NotificationsPanel() {
  const [items, setItems] = useState<NebulaNotification[]>([])

  function refresh() {
    setItems(getNotifications())
  }

  function markRead() {
    markNotificationsRead()
    refresh()
  }

  function clear() {
    clearNotifications()
    refresh()
  }

  useEffect(() => {
    refresh()
    const listener = () => refresh()
    window.addEventListener('nebula-notifications-changed', listener)
    return () => window.removeEventListener('nebula-notifications-changed', listener)
  }, [])

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <button className="nebula-button-primary flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={markRead}>
          <CheckCheck size={13} />
          Mark Read
        </button>
        <button className="nebula-toggle flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={clear}>
          <Trash2 size={13} />
          Clear
        </button>
      </div>

      {items.length === 0 && <div className="nebula-note p-3 text-slate-400">Task, model, memory, and error notifications will appear here.</div>}

      {items.map((item) => (
        <section key={item.id} className={`skill-card rounded-md border p-3 ${item.read ? 'border-slate-800 bg-slate-950' : 'border-cyan-300/35 bg-cyan-300/10'}`}>
          <div className="flex items-start gap-2">
            <Bell size={14} className={item.type === 'error' || item.type === 'build_failed' ? 'text-red-200' : 'text-cyan-200'} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-100">{item.title}</div>
              <p className="mt-1 text-xs leading-5 text-slate-300">{item.message}</p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{item.type}</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
