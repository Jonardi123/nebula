import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { ChatMessage } from '../types/agent'
import type { ComposerAttachment, ConversationSession } from '../types/nebula'
import { createConversation, deriveConversationTitle, loadConversationStore, saveConversationStore } from '../lib/conversations'
import { conversationRepository, discardScheduledConversationSave, scheduleConversationSave } from '../lib/storage'
import { isTauriRuntime } from '../lib/runtime'

export function createMessage(role: ChatMessage['role'], content: string, attachments?: ComposerAttachment[]): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), attachments: attachments?.length ? attachments : undefined }
}

function bootMessage() {
  return createMessage('assistant', 'Nebula online. Point me at a project folder, make sure LM Studio local server is running, and I can start working.')
}

export function useMessages(projectFolder = '') {
  const [store, setStore] = useState(() => loadConversationStore(projectFolder))
  const hydrated = useRef(false)
  const initialStore = useRef(store)
  const activeConversation = useMemo(
    () => store.sessions.find((session) => session.id === store.activeId) ?? store.sessions[0],
    [store],
  )
  const messages = activeConversation?.messages ?? [bootMessage()]

  useEffect(() => {
    if (isTauriRuntime()) {
      if (hydrated.current) scheduleConversationSave(store)
    }
    else saveConversationStore(store)
  }, [store])

  useEffect(() => {
    let active = true
    void conversationRepository.load().then((durable) => {
      if (!active || hydrated.current) return
      hydrated.current = true
      if (durable) setStore(durable)
      else scheduleConversationSave(initialStore.current)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen('nebula-mobile-conversations-changed', () => {
      discardScheduledConversationSave()
      void conversationRepository.load().then((durable) => {
        if (!disposed && durable) setStore(durable)
      }).catch(() => undefined)
    }).then((cleanup) => { unlisten = cleanup }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [])

  const setMessages = useCallback<Dispatch<SetStateAction<ChatMessage[]>>>((update) => {
    setStore((current) => {
      const active = current.sessions.find((session) => session.id === current.activeId) ?? current.sessions[0]
      if (!active) return current
      const nextMessages = typeof update === 'function' ? update(active.messages) : update
      const nextSession: ConversationSession = {
        ...active,
        messages: nextMessages,
        title: deriveConversationTitle(nextMessages, active.title === 'New chat' ? 'New chat' : active.title),
        updatedAt: new Date().toISOString(),
      }
      return {
        ...current,
        sessions: current.sessions.map((session) => (session.id === active.id ? nextSession : session)),
      }
    })
  }, [])

  const setConversationMessages = useCallback((conversationId: string, update: SetStateAction<ChatMessage[]>) => {
    setStore((current) => ({
      ...current,
      sessions: current.sessions.map((session) => {
        if (session.id !== conversationId) return session
        const nextMessages = typeof update === 'function' ? update(session.messages) : update
        return {
          ...session,
          messages: nextMessages,
          title: deriveConversationTitle(nextMessages, session.title === 'New chat' ? 'New chat' : session.title),
          updatedAt: new Date().toISOString(),
        }
      }),
    }))
  }, [])

  const ensureConversation = useCallback((id: string, folder = projectFolder) => {
    setStore((current) => {
      if (current.sessions.some((session) => session.id === id)) return current
      const session = { ...createConversation(folder), id }
      return { ...current, sessions: [session, ...current.sessions] }
    })
    return id
  }, [projectFolder])

  const addMessage = useCallback((role: ChatMessage['role'], content: string) => {
    setMessages((current) => [...current, createMessage(role, content)])
  }, [setMessages])

  const clearMessages = useCallback(() => {
    setMessages([bootMessage()])
  }, [setMessages])

  const newConversation = useCallback((folder = projectFolder) => {
    const session = createConversation(folder)
    setStore((current) => ({
      version: current.version,
      activeId: session.id,
      sessions: [session, ...current.sessions],
      folders: current.folders,
    }))
    return session.id
  }, [projectFolder])

  const selectConversation = useCallback((id: string) => {
    void conversationRepository.flush()
    setStore((current) => (current.sessions.some((session) => session.id === id) ? { ...current, activeId: id } : current))
  }, [])

  const deleteConversation = useCallback((id: string) => {
    void conversationRepository.flush()
    setStore((current) => {
      const remaining = current.sessions.filter((session) => session.id !== id)
      if (remaining.length === 0) {
        const session = createConversation(projectFolder)
        return { ...current, activeId: session.id, sessions: [session] }
      }
      return {
        ...current,
        activeId: current.activeId === id ? remaining[0].id : current.activeId,
        sessions: remaining,
      }
    })
  }, [projectFolder])

  const toggleConversationPinned = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (session.id === id ? { ...session, pinned: !session.pinned, updatedAt: new Date().toISOString() } : session)),
    }))
  }, [])

  const createConversationFolder = useCallback((name: string) => {
    const clean = name.trim().slice(0, 48)
    if (!clean) return ''
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    setStore((current) => ({
      ...current,
      folders: [{ id, name: clean, createdAt: timestamp, updatedAt: timestamp }, ...current.folders],
    }))
    return id
  }, [])

  const renameConversationFolder = useCallback((id: string, name: string) => {
    const clean = name.trim().slice(0, 48)
    if (!clean) return
    setStore((current) => ({
      ...current,
      folders: current.folders.map((folder) => folder.id === id ? { ...folder, name: clean, updatedAt: new Date().toISOString() } : folder),
    }))
  }, [])

  const deleteConversationFolder = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      folders: current.folders.filter((folder) => folder.id !== id),
      sessions: current.sessions.map((session) => session.folderId === id ? { ...session, folderId: undefined } : session),
    }))
  }, [])

  const moveConversationToFolder = useCallback((conversationId: string, folderId?: string) => {
    setStore((current) => ({
      ...current,
      sessions: current.sessions.map((session) => session.id === conversationId ? { ...session, folderId, updatedAt: new Date().toISOString() } : session),
    }))
  }, [])

  return {
    messages,
    setMessages,
    setConversationMessages,
    addMessage,
    clearMessages,
    conversations: [...store.sessions].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      return right.updatedAt.localeCompare(left.updatedAt)
    }),
    conversationFolders: store.folders,
    activeConversationId: activeConversation?.id ?? store.activeId,
    activeConversation,
    newConversation,
    ensureConversation,
    selectConversation,
    deleteConversation,
    toggleConversationPinned,
    createConversationFolder,
    renameConversationFolder,
    deleteConversationFolder,
    moveConversationToFolder,
    createMessage,
  }
}
