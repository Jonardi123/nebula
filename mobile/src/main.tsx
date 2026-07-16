import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { initializeNativeRuntime, isNativeMobile } from './platform'

void initializeNativeRuntime()

if (!isNativeMobile && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/mobile-sw.js').then((registration) => {
    const announce = () => window.dispatchEvent(new CustomEvent('nebula-mobile-update-ready'))
    if (registration.waiting && navigator.serviceWorker.controller) announce()
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announce()
      })
    })
  }).catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
