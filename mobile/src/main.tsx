import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { initializeNativeRuntime, isNativeMobile } from './platform'

void initializeNativeRuntime()

if (!isNativeMobile && 'serviceWorker' in navigator && import.meta.env.PROD) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })

  window.addEventListener('load', () => navigator.serviceWorker.register('/mobile-sw.js', {
    updateViaCache: 'none',
  }).then(async (registration) => {
    const activateWaitingWorker = () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
    activateWaitingWorker()
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') activateWaitingWorker()
      })
    })
    await registration.update()
  }).catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
