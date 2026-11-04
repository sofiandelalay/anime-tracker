import { useEffect, useRef, useState } from 'react'
import { exportData, importData, markExported, parseBackup } from '../../db/backup'
import { clearCache, storageEstimate } from '../../db/maintenance'
import { db } from '../../db/trackerDb'
import { formatBytes, formatDate } from '../../domain/format'
import { ensureData } from '../../domain/sync'
import { IconChevronLeft } from '../components/Icons'
import { useToast } from '../components/Toast'
import { useLive } from '../hooks/hooks'

export function Settings({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [usage, setUsage] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const lastExport = useLive(async () => ((await db.meta.get('lastExportAt'))?.value as number | undefined) ?? null, [])
  const count = useLive(() => db.entries.count(), [])

  const refreshUsage = () => storageEstimate().then((e) => setUsage(e?.usage ?? null))
  useEffect(() => {
    void refreshUsage()
  }, [])

  const onClear = async () => {
    setBusy(true)
    try {
      await clearCache()
      await refreshUsage()
      toast({ message: 'Cache vidé. Tes données sont intactes.' })
      void ensureData().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const onExport = async () => {
    const now = Date.now()
    const data = await exportData(now)
    const name = `animes-${new Date(now).toISOString().slice(0, 10)}.json`
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mes animes' })
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
      await markExported(now)
      toast({ message: 'Export prêt' })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ message: 'L’export n’a pas pu se faire.' })
    }
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const backup = parseBackup(await file.text())
      const ok = window.confirm(
        `Remplacer ta liste actuelle par celle du fichier (${backup.entries.length} anime${backup.entries.length > 1 ? 's' : ''}) ?`,
      )
      if (!ok) return
      await importData(backup)
      toast({ message: 'Import terminé' })
      void ensureData().catch(() => undefined)
    } catch (e) {
      toast({ message: (e as Error).message })
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="screen screen--pushed">
      <header className="bar">
        <div className="bar__row">
          <button type="button" className="back-button" onClick={onBack}>
            <IconChevronLeft width={22} height={22} /> Stats
          </button>
        </div>
      </header>
      <main className="screen__content">
        <h1 className="large-title">Réglages</h1>

        <h2 className="section-title">Stockage</h2>
        <div className="group">
          <div className="row">
            <span>Espace utilisé</span>
            <span className="row__value">{usage === null ? '—' : formatBytes(usage)}</span>
          </div>
          <button type="button" className="row row--button" onClick={onClear} disabled={busy}>
            Vider le cache
          </button>
        </div>
        <p className="footnote">Supprime les recherches et les jaquettes. Ta liste n’est jamais touchée.</p>

        <h2 className="section-title">Mes données</h2>
        <div className="group">
          <button type="button" className="row row--button" onClick={onExport} disabled={count === 0}>
            Exporter (JSON)
          </button>
          <button type="button" className="row row--button" onClick={() => fileInput.current?.click()}>
            Importer (JSON)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => onImport(e.target.files?.[0])}
          />
        </div>
        <p className="footnote">
          {lastExport ? `Dernier export : ${formatDate(lastExport)}.` : 'Aucun export pour l’instant.'} Pense à en faire un de temps en temps.
        </p>
      </main>
    </div>
  )
}
