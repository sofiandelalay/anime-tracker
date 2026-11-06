import { useEffect, useRef, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { boot, refreshAired } from '../domain/sync'
import { ErrorBoundary } from './components/ErrorBoundary'
import { IconCalendar, IconChart, IconList, IconSearch, IconSparkles } from './components/Icons'
import { ToastProvider, useToast } from './components/Toast'
import { subscribeMinute } from './hooks/clock'
import { AnimeFlowProvider } from './screens/AnimeFlow'
import { ForYou } from './screens/ForYou'
import { MyList } from './screens/MyList'
import { Releases } from './screens/Releases'
import { Search } from './screens/Search'
import { Stats } from './screens/Stats'

type Tab = 'list' | 'releases' | 'search' | 'foryou' | 'stats'

const TABS: { id: Tab; label: string; Icon: ComponentType<{ width?: number; height?: number }> }[] = [
  { id: 'list', label: 'Ma liste', Icon: IconList },
  { id: 'releases', label: 'Sorties', Icon: IconCalendar },
  { id: 'search', label: 'Rechercher', Icon: IconSearch },
  { id: 'foryou', label: 'Pour toi', Icon: IconSparkles },
  { id: 'stats', label: 'Stats', Icon: IconChart },
]

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AnimeFlowProvider>
          <Shell />
        </AnimeFlowProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>('list')
  // Les écrans restent montés pour garder leur position de défilement.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['list']))

  useEffect(() => {
    void boot()
    // Un compte à rebours écoulé : la fiche est rechargée pour pouvoir cocher le nouvel épisode.
    return subscribeMinute(() => {
      if (navigator.onLine) void refreshAired().catch(() => undefined)
    })
  }, [])

  const searchInput = useRef<HTMLInputElement>(null)
  const select = (t: Tab) => {
    const show = () => {
      setTab(t)
      setVisited((v) => (v.has(t) ? v : new Set(v).add(t)))
    }
    if (t !== 'search') {
      searchInput.current?.blur()
      show()
      return
    }
    // iOS n'ouvre le clavier que si le focus est donné pendant le toucher : l'écran doit donc exister tout de suite.
    flushSync(show)
    searchInput.current?.focus({ preventScroll: true })
  }

  return (
    <div className="app">
      <UpdatePrompt />
      {visited.has('list') && <section className="tab-panel" hidden={tab !== 'list'}><MyList onSearch={() => select('search')} /></section>}
      {visited.has('releases') && <section className="tab-panel" hidden={tab !== 'releases'}><Releases /></section>}
      {visited.has('search') && <section className="tab-panel" hidden={tab !== 'search'}><Search inputRef={searchInput} /></section>}
      {visited.has('foryou') && <section className="tab-panel" hidden={tab !== 'foryou'}><ForYou active={tab === 'foryou'} /></section>}
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
