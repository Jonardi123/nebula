import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { listeners, addListener } = vi.hoisted(() => {
  const listeners = new Map<string, () => void>()
  return {
    listeners,
    addListener: vi.fn(async (event: string, listener: () => void) => {
      listeners.set(event, listener)
      return { remove: vi.fn(async () => listeners.delete(event)) }
    }),
  }
})

vi.mock('./platform', () => ({ isNativeMobile: true }))
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener } }))

import { useMobileViewport } from './useMobileViewport'

function Probe() {
  const open = useMobileViewport()
  return <span data-testid="keyboard-state">{open ? 'open' : 'closed'}</span>
}

describe('native mobile viewport', () => {
  it('tracks native keyboard events without applying visual viewport dimensions', async () => {
    const view = render(<Probe />)
    await waitFor(() => expect(addListener).toHaveBeenCalledTimes(4))

    act(() => listeners.get('keyboardWillShow')?.())
    expect(screen.getByTestId('keyboard-state').textContent).toBe('open')
    expect(document.documentElement.classList.contains('native-mobile')).toBe(true)
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('')

    act(() => listeners.get('keyboardDidHide')?.())
    expect(screen.getByTestId('keyboard-state').textContent).toBe('closed')
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false)

    view.unmount()
    expect(document.documentElement.classList.contains('native-mobile')).toBe(false)
  })
})
