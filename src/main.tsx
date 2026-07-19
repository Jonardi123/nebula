import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './styles/studio.css'
import './styles/blackMatter.css'
import { AmbientOverlayApp } from './AmbientOverlayApp'
import App from './App'
import { initializeStorage, installStorageLifecycle } from './lib/storage'

void initializeStorage()
installStorageLifecycle()

const isAmbientOverlay = new URLSearchParams(window.location.search).get('overlay') === 'ambient'
const root = document.getElementById('root')

if (!root) {
  throw new Error('Nebula root element is missing.')
}

createRoot(root).render(
  <StrictMode>
    {isAmbientOverlay ? <AmbientOverlayApp /> : <App />}
  </StrictMode>,
)
