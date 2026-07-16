import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../lib/settings'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('') }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }))

function renderSidebar() {
  return render(
    <Sidebar
      settings={DEFAULT_SETTINGS}
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
})
