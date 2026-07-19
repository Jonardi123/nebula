import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../lib/settings'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('') }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }))

function renderSidebar(settings = DEFAULT_SETTINGS) {
  return render(
    <Sidebar
      settings={settings}
      logs={[]}
      files={[]}
      onOpenFile={vi.fn()}
      onSettingsChange={vi.fn()}
      skillsVersion={0}
      onSkillsChange={vi.fn()}
      onStartTask={vi.fn()}
      onFixMyApp={vi.fn()}
      onLauncherAction={vi.fn()}
      onQuickAction={vi.fn()}
      agentStatus="idle"
      lmOnline={false}
      memoryReady={true}
      onLog={vi.fn()}
    />,
  )
}

describe('Sidebar interaction', () => {
  it('opens and closes the project drawer', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const project = screen.getByRole('button', { name: 'Projects' })
    await user.click(project)
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(screen.queryByRole('button', { name: 'Close panel' })).not.toBeInTheDocument()
  })

  it('dismisses the avatar popover on outside click', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Customize Nebula avatar' }))
    expect(screen.getByText('Avatar')).toBeVisible()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('Avatar')).not.toBeInTheDocument()
  })

  it('keeps specialist navigation out of Simple Mode', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skills' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeVisible()
  })

  it('restores specialist navigation in Advanced Mode', () => {
    renderSidebar({ ...DEFAULT_SETTINGS, experienceMode: 'advanced' })
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Skills' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeVisible()
  })
})
