import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { DEFAULT_SETTINGS } from '../lib/settings'
import type { AppSettings } from '../types/settings'
import { ChatPanel } from './ChatPanel'

vi.mock('../lib/lmstudio', () => ({
  listProviderModelInfos: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }))

function renderPanel(onSend = vi.fn(), settings: AppSettings = DEFAULT_SETTINGS) {
  const result = render(
    <ChatPanel
      messages={[]}
      disabled={false}
      onSend={onSend}
      settings={settings}
      onSettingsChange={vi.fn()}
    />,
  )
  return { ...result, onSend }
}

describe('ChatPanel composer', () => {
  it('focuses the textarea from the full composer surface', () => {
    const { container } = renderPanel()
    const composer = container.querySelector('.chat-composer')
    const textarea = screen.getByPlaceholderText('Ask Nebula anything...')
    expect(composer).not.toBeNull()
    fireEvent.pointerDown(composer!)
    expect(textarea).toHaveFocus()
  })

  it('hides model and context diagnostics in Simple Mode', () => {
    renderPanel()
    expect(screen.queryByRole('option', { name: 'Auto routing' })).not.toBeInTheDocument()
    expect(screen.queryByText('Context')).not.toBeInTheDocument()
  })

  it('shows actionable recovery without blocking the composer', () => {
    const onRecovery = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        disabled={false}
        onSend={vi.fn()}
        settings={DEFAULT_SETTINGS}
        onSettingsChange={vi.fn()}
        recovery={{ code: 'offline', title: 'Local AI is offline', message: 'Start LM Studio.', recoverable: true, action: 'open_lmstudio', actionLabel: 'Fix it' }}
        onRecovery={onRecovery}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    expect(onRecovery).toHaveBeenCalledOnce()
    expect(screen.getByPlaceholderText('Ask Nebula anything...')).toBeEnabled()
  })

  it('sends on Enter and preserves Shift+Enter for a newline', async () => {
    const user = userEvent.setup()
    const { onSend } = renderPanel()
    const textarea = screen.getByPlaceholderText('Ask Nebula anything...')
    await user.click(textarea)
    await user.type(textarea, 'hello{shift>}{enter}{/shift}world')
    expect(onSend).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('hello\nworld', [])
  })

  it.each([
    ['Web search', '[WEB SEARCH]\nSearch the web for current sources, cite useful links, then answer. Query: '],
    ['Deep research', '[DEEP RESEARCH]\nDo deeper multi-source research. Search broadly, compare sources, summarize findings, and cite links. Research goal: '],
    ['Project search', '[LOCAL PROJECT SEARCH]\nSearch and inspect the active project before answering. Goal: '],
  ])('submits the %s mode through the agent pipeline', async (label, prefix) => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderPanel(onSend, { ...DEFAULT_SETTINGS, projectFolder: 'D:/Nebula' })

    await user.click(screen.getByTitle('Search modes'))
    await user.click(screen.getByRole('button', { name: label }))
    await user.type(screen.getByPlaceholderText('Ask Nebula anything...'), 'test request')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith(`${prefix}test request`, [])
  })

  it('fills the composer for prompt-based tools', async () => {
    const user = userEvent.setup()
    renderPanel()
    const textarea = screen.getByPlaceholderText('Ask Nebula anything...')
    const cases = [
      ['Create image prompt', 'Create an image prompt/spec for: '],
      ['Guided learning', 'Teach me step-by-step with guided learning about: '],
      ['Personal Intelligence', 'Use memory and preferences to personalize this: '],
    ]

    for (const [label, expected] of cases) {
      await user.clear(textarea)
      await user.click(screen.getByTitle('Add tools and context'))
      await user.click(screen.getByRole('button', { name: new RegExp(label) }))
      expect(textarea).toHaveValue(expected)
    }
  })

  it('attaches selected files and folders to the submitted message', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    vi.mocked(open)
      .mockResolvedValueOnce(['D:/Nebula/src/App.tsx', 'D:/Nebula/package.json'])
      .mockResolvedValueOnce('D:/Nebula/src')
    renderPanel(onSend)

    await user.click(screen.getByTitle('Add tools and context'))
    await user.click(screen.getByRole('button', { name: 'Files and folders' }))
    expect(await screen.findByText('App.tsx')).toBeInTheDocument()
    expect(screen.getByText('package.json')).toBeInTheDocument()

    await user.click(screen.getByTitle('Add tools and context'))
    await user.click(screen.getByRole('button', { name: 'Select folder' }))
    expect(await screen.findByText('src')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Ask Nebula anything...'), 'Review these')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('Review these', expect.arrayContaining([
      expect.objectContaining({ kind: 'file', path: 'D:/Nebula/src/App.tsx' }),
      expect.objectContaining({ kind: 'file', path: 'D:/Nebula/package.json' }),
      expect.objectContaining({ kind: 'folder', path: 'D:/Nebula/src' }),
    ]))
  })

  it('disables context actions that do not have required local state', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTitle('Add tools and context'))
    expect(screen.getByRole('button', { name: 'Project context' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Current file' })).toBeDisabled()
  })
})
