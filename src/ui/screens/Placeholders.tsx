import { useState } from 'react'
import { EmptyState } from '../components/Bits'
import { IconGear } from '../components/Icons'
import { Settings } from './Settings'

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="screen">
      <header className="bar bar--empty" />
      <main className="screen__content">
        <h1 className="large-title">{title}</h1>
        <EmptyState title="Bientôt" text="Cet espace se prépare tranquillement." />
      </main>
    </div>
  )
}

export function Stats() {
  const [settings, setSettings] = useState(false)
  if (settings) return <Settings onBack={() => setSettings(false)} />
  return (
    <div className="screen">
      <header className="bar">
        <div className="bar__row bar__row--end">
          <button type="button" className="icon-button icon-button--muted" onClick={() => setSettings(true)} aria-label="Réglages">
            <IconGear width={22} height={22} />
          </button>
        </div>
      </header>
      <main className="screen__content">
        <h1 className="large-title">Stats</h1>
        <EmptyState title="Bientôt" text="Tes statistiques arriveront ici." />
      </main>
    </div>
  )
}
