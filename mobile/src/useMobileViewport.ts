import { useEffect, useState } from 'react'

const KEYBOARD_THRESHOLD = 120

export function isKeyboardViewport(baseline: number, height: number) {
  return baseline - height > KEYBOARD_THRESHOLD
}

export function useMobileViewport() {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    let baseline = window.visualViewport?.height ?? window.innerHeight
    let frame = 0

    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport
        const height = Math.round(viewport?.height ?? window.innerHeight)
        const top = Math.round(viewport?.offsetTop ?? 0)
        const nextKeyboardOpen = isKeyboardViewport(baseline, height)
        if (!nextKeyboardOpen) baseline = Math.max(baseline, height)
        root.style.setProperty('--app-height', `${height}px`)
        root.style.setProperty('--app-top', `${top}px`)
        root.classList.toggle('keyboard-open', nextKeyboardOpen)
        setKeyboardOpen(nextKeyboardOpen)
        if (window.scrollY !== 0) window.scrollTo(0, 0)
      })
    }

    const reset = () => {
      window.setTimeout(() => {
        baseline = window.visualViewport?.height ?? window.innerHeight
        update()
      }, 180)
    }

    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', reset)
    return () => {
      cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', reset)
      root.classList.remove('keyboard-open')
    }
  }, [])

  return keyboardOpen
}
