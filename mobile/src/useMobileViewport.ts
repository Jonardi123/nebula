import { useEffect, useState } from 'react'
import { Keyboard } from '@capacitor/keyboard'
import { isNativeMobile } from './platform'

const KEYBOARD_THRESHOLD = 120

export function isKeyboardViewport(baseline: number, height: number) {
  return baseline - height > KEYBOARD_THRESHOLD
}

export function useMobileViewport() {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const standalone = (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    root.classList.toggle('native-mobile', isNativeMobile)
    root.classList.toggle('web-mobile', !isNativeMobile)
    root.classList.toggle('pwa-standalone', !isNativeMobile && standalone)

    if (isNativeMobile) {
      let disposed = false
      const handles: Array<{ remove: () => Promise<void> }> = []
      const setOpen = (open: boolean) => {
        if (disposed) return
        root.classList.toggle('keyboard-open', open)
        setKeyboardOpen(open)
      }

      void Promise.all([
        Keyboard.addListener('keyboardWillShow', () => setOpen(true)),
        Keyboard.addListener('keyboardDidShow', () => setOpen(true)),
        Keyboard.addListener('keyboardWillHide', () => setOpen(false)),
        Keyboard.addListener('keyboardDidHide', () => setOpen(false)),
      ]).then((listeners) => {
        if (disposed) void Promise.all(listeners.map((listener) => listener.remove()))
        else handles.push(...listeners)
      }).catch(() => undefined)

      return () => {
        disposed = true
        root.classList.remove('keyboard-open', 'native-mobile')
        void Promise.all(handles.map((listener) => listener.remove()))
      }
    }

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
      root.classList.remove('web-mobile')
      root.classList.remove('pwa-standalone')
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
    }
  }, [])

  return keyboardOpen
}
