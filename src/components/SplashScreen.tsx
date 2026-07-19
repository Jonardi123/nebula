import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StartupAnimationMode } from '../types/settings'

const BOOT_STATES = ['Starting core', 'Restoring memory', 'Preparing workspace', 'Ready']

interface Props {
  mode?: StartupAnimationMode
  onComplete: () => void
}

export function SplashScreen({ mode = 'cinematic', onComplete }: Props) {
  const [statusIndex, setStatusIndex] = useState(0)
  const [exiting, setExiting] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const completed = useRef(false)
  const exitTimer = useRef<number | null>(null)
  const effectiveMode = reducedMotion && mode !== 'simple' && mode !== 'off' ? 'simple' : mode
  const timing = useMemo(
    () => effectiveMode === 'simple'
      ? { statusStep: 170, done: 760, exit: 240 }
      : { statusStep: 280, done: 1480, exit: 380 },
    [effectiveMode],
  )

  const finish = useCallback(() => {
    if (completed.current) return
    completed.current = true
    setExiting(true)
    exitTimer.current = window.setTimeout(onComplete, timing.exit)
  }, [onComplete, timing.exit])

  useEffect(() => {
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!motionQuery) return
    const update = () => setReducedMotion(motionQuery.matches)
    update()
    motionQuery.addEventListener?.('change', update)
    return () => motionQuery.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const statusTimers = BOOT_STATES.map((_, index) =>
      window.setTimeout(() => setStatusIndex(index), index * timing.statusStep),
    )
    const doneTimer = window.setTimeout(finish, timing.done)

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') finish()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      statusTimers.forEach(window.clearTimeout)
      window.clearTimeout(doneTimer)
      if (exitTimer.current) window.clearTimeout(exitTimer.current)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [finish, timing.done, timing.statusStep])

  return (
    <div
      className={`nebula-splash nebula-splash-awakening nebula-splash-${effectiveMode} ${exiting ? 'nebula-splash-exit' : ''}`}
      onClick={finish}
      role="presentation"
    >
      <div className="awakening-scene" aria-hidden="true">
        <div className="awakening-stars awakening-stars-far" />
        <div className="awakening-stars awakening-stars-near" />
        <div className="awakening-veil awakening-veil-cyan" />
        <div className="awakening-veil awakening-veil-violet" />
        <div className="awakening-horizon" />
        <div className="awakening-orbit awakening-orbit-outer" />
        <div className="awakening-orbit awakening-orbit-inner" />
        <div className="awakening-core">
          <span className="awakening-core-light" />
          <span className="awakening-core-shadow" />
        </div>
      </div>

      <button
        type="button"
        className="nebula-skip awakening-skip"
        onClick={(event) => {
          event.stopPropagation()
          finish()
        }}
      >
        Skip
      </button>

      <section className="awakening-identity" aria-live="polite">
        <div className="awakening-symbol" aria-hidden="true">
          <span />
        </div>
        <h1>Nebula</h1>
        <div className="awakening-status">
          <span className={statusIndex === BOOT_STATES.length - 1 ? 'awakening-status-ready' : ''} />
          <p key={BOOT_STATES[statusIndex]}>{BOOT_STATES[statusIndex]}</p>
        </div>
        <div className="awakening-progress" aria-hidden="true">
          {BOOT_STATES.map((state, index) => (
            <span key={state} className={index <= statusIndex ? 'awakening-progress-active' : ''} />
          ))}
        </div>
      </section>
    </div>
  )
}
