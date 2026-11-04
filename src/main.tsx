import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './ui/tokens.css'
import './ui/app.css'

// Active les états :active de Safari iOS (retour visuel immédiat au toucher).
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
