import { describe, expect, it } from 'vitest'
import { loadConversationStore, saveConversationStore, searchConversations } from './conversations'
import type { ConversationSession } from '../types/nebula'

function session(id: string, title: string, content: string): ConversationSession {
  const timestamp = '2026-07-10T10:00:00.000Z'
  return {
    id,
    title,
    pinned: false,
    messages: [{ id: `${id}-message`, role: 'user', content, createdAt: timestamp }],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('conversation persistence', () => {
  it('recovers from corrupted storage without crashing', () => {
    localStorage.setItem('nebula-conversations-v1', '{not json')
    const store = loadConversationStore('D:\\Projects\\Nebula')
    expect(store.version).toBe(2)
    expect(store.sessions).toHaveLength(1)
    expect(store.folders).toEqual([])
    expect(localStorage.getItem('nebula-conversations-v1-recovery')).toContain('{not json')
  })

  it('migrates and persists folders without losing sessions', () => {
    const chat = { ...session('one', 'Router work', 'Fix the model router'), folderId: 'folder-one' }
    saveConversationStore({
      version: 2,
      activeId: chat.id,
      sessions: [chat],
      folders: [{ id: 'folder-one', name: 'Nebula', createdAt: chat.createdAt, updatedAt: chat.updatedAt }],
    })
    const loaded = loadConversationStore()
    expect(loaded.sessions[0].folderId).toBe('folder-one')
    expect(loaded.folders[0].name).toBe('Nebula')
  })

  it('searches message bodies, not only titles', () => {
    const results = searchConversations([
      session('one', 'General chat', 'The fallback model failed to load'),
      session('two', 'UI work', 'Polish the composer'),
    ], 'fallback load')
    expect(results[0].conversationId).toBe('one')
    expect(results[0].excerpt).toContain('fallback')
  })
})
