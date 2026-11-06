import { useMemo, useState } from 'react'
import { db } from '../../db/trackerDb'
import { displayTitle, formatHours, genreLabel } from '../../domain/format'
import { buildStats, type Stats as StatsData } from '../../domain/stats'
import { hasTicked } from '../../domain/viewings'
import { Cover, EmptyState } from '../components/Bits'
import { IconGear } from '../components/Icons'
import { useLibrary, useLive } from '../hooks/hooks'
import { Settings } from './Settings'

export function Stats() {
  const [settings, setSettings] = useState(false)
  const library = useLibrary()
  const log = useLive(() => db.log.toArray(), [])
  const stats = useMemo(
    () => (library && log ? buildStats(library.entries, library.media, log, Date.now()) : null),
    [library, log],
  )

  if (settings) return <Settings onBack={() => setSettings(false)} />
  return (
    <div className="screen">
      <header className="bar">
        <div className="compact-header">
          <h1 className="compact-header__title">Stats</h1>
          <button type="button" className="icon-button icon-button--muted compact-header__icon" onClick={() => setSettings(true)} aria-label="Réglages">
            <IconGear width={22} height={22} />
          </button>
        </div>
      </header>
      <main className="screen__content">
        {stats && library && (library.entries.some(hasTicked) ? (
          <StatBlocks stats={stats} />
        ) : (
          <EmptyState title="Tout reste à écrire" text="Coche ton premier épisode, tes chiffres apparaîtront ici." />
        ))}
      </main>
    </div>
  )
}

function StatBlocks({ stats }: { stats: StatsData }) {
  const topEpisodes = stats.genres[0]?.episodes ?? 0
  return (
    <div className="stats">
      <section className="stat stat--wide">
        <h2 className="stat__label">Heures regardées</h2>
        <div className="stat__pair">
          <div>
            <p className="stat__hero">{formatHours(stats.totalMinutes)}</p>
            <p className="stat__sub">{formatHours(stats.monthMinutes)} ce mois-ci</p>
            {stats.rewatchMinutes > 0 && <p className="stat__sub">dont {formatHours(stats.rewatchMinutes)} en revisionnage</p>}
          </div>
          <div className="stat__right">
            <p className="stat__hero">{stats.episodes.toLocaleString('fr-FR')}</p>
            <p className="stat__sub">épisode{stats.episodes > 1 ? 's' : ''}</p>
          </div>
        </div>
      </section>

      <section className="stat">
        <h2 className="stat__label">Animes terminés</h2>
        <p className="stat__value">{stats.completed}</p>
      </section>

      <section className="stat">
        <h2 className="stat__label">Studio favori</h2>
        {stats.favoriteStudio ? (
          <p className="stat__name">{stats.favoriteStudio.name}</p>
        ) : (
          <p className="stat__sub">Note 4 étoiles ou plus pour le découvrir.</p>
        )}
      </section>

      {stats.rewatches > 0 && (
        <section className="stat stat--wide">
          <h2 className="stat__label">Revisionnages</h2>
          <p className="stat__value">{stats.rewatches}</p>
          {stats.mostRewatched && (
            <div className="stat__most">
              <Cover src={stats.mostRewatched.media.cover} size="s" />
              <div className="stat__most-text">
                <span className="stat__sub">Le plus revu</span>
                <span className="stat__most-title">{displayTitle(stats.mostRewatched.media)}</span>
                <span className="stat__sub">vu {stats.mostRewatched.times} fois</span>
              </div>
            </div>
          )}
        </section>
      )}

      {stats.genres.length > 0 && (
        <section className="stat stat--wide">
          <h2 className="stat__label">Genres préférés</h2>
          <ul className="genre-bars">
            {stats.genres.map((g) => (
              <li key={g.name}>
                <span className="genre-bars__head">
                  <span>{genreLabel(g.name)}</span>
                  <span className="genre-bars__value">{g.episodes} ép.</span>
                </span>
                <span className="genre-bars__bar" aria-hidden="true" style={{ width: `${(g.episodes / topEpisodes) * 100}%` }} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
