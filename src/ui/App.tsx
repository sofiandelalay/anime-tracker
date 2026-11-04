import { useEffect, useState, type ComponentType } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { boot } from '../domain/sync'
import { IconCalendar, IconChart, IconList, IconSparkles } from './components/Icons'
import { ToastProvider, useToast } from './components/Toast'
import { MyList } from './screens/MyList'
import { ComingSoon, Stats } from './screens/Placeholders'

type Tab = 'list' | 'seasons' | 'foryou' | 'stats'

const TABS: { id: Tab; label: string; Icon: ComponentType<{ width?: number; height?: number }> }[] = [
  { id: 'list', label: 'Ma liste', Icon: IconList },
  { id: 'seasons', label: 'Saisons', Icon: IconCalendar },
  { id: 'foryou', label: 'Pour toi', Icon: IconSparkles },
  { id: 'stats', label: 'Stats', Icon: IconChart },
]

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>('list')
  // Les écrans restent montés pour garder leur position de défilement.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['list']))

  useEffect(() => {
    void boot()
  }, [])

  const select = (t: Tab) => {
    setTab(t)
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)))
  }

  return (
    <div className="app">
      <UpdatePrompt />
      {visited.has('list') && <section className="tab-panel" hidden={tab !== 'list'}><MyList /></section>}
      {visited.has('seasons') && <section className="tab-panel" hidden={tab !== 'seasons'}><ComingSoon title="Saisons" /></section>}
      {visited.has('foryou') && <section className="tab-panel" hidden={tab !== 'foryou'}><ComingSoon title="Pour toi" /></section>}
      {visited.has('stats') && <section className="tab-panel" hidden={tab !== 'stats'}><Stats /></section>}

      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`tabbar__item${tab === id ? ' is-active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => select(id)}
          >
            <Icon width={26} height={26} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

/** Toast discret quand une nouvelle version du service worker est prête. */
function UpdatePrompt() {
  const toast = useToast()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Vérifie les mises à jour toutes les heures quand l'appli reste ouverte.
      if (registration) setInterval(() => void registration.update(), 3600_000)
    },
  })

  useEffect(() => {
    if (needRefresh) {
      toast({ message: 'Nouvelle version', action: { label: 'Recharger', onAction: () => updateServiceWorker(true) }, duration: 0 })
    }
  }, [needRefresh, toast, updateServiceWorker])

  return null
}
