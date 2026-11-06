import type { Media } from './types'

export const displayTitle = (m: Pick<Media, 'title'>): string =>
  m.title.english || m.title.romaji || 'Sans titre'

export const startKey = (m: Pick<Media, 'startDate'>): number => {
  const { year, month, day } = m.startDate
  if (!year) return Number.POSITIVE_INFINITY
  return year * 10000 + (month ?? 12) * 100 + (day ?? 31)
}

export const compareByStart = (a: Media, b: Media): number => startKey(a) - startKey(b) || a.id - b.id

const FORMAT_LABEL: Record<string, string> = {
  TV: 'TV', TV_SHORT: 'TV court', MOVIE: 'Film', SPECIAL: 'Spécial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Clip',
}
export const formatLabel = (f: string | null): string => (f ? FORMAT_LABEL[f] ?? f : '')

export const mediaYear = (m: Media): number | null => m.seasonYear ?? m.startDate.year

export const formatBytes = (n: number): string => {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`
  return `${(n / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

export const formatDate = (t: number): string =>
  new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Date de début d'une saison à venir : « 10 janv. », « janvier », sinon null. */
export function formatStartDate({ year, month, day }: Media['startDate']): string | null {
  if (!year || !month) return null
  const d = new Date(Date.UTC(year, month - 1, day ?? 1))
  return day
    ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })
}

const MINUTE = 60_000

/** Temps restant : « 2 j 4 h », « 4 h 20 min », « 35 min ». */
export function formatCountdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE))
  if (minutes < 60) return `${minutes} min`
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m ? `${h} h ${m} min` : `${h} h`
  }
  const d = Math.floor(minutes / (24 * 60))
  const h = Math.floor((minutes % (24 * 60)) / 60)
  return h ? `${d} j ${h} h` : `${d} j`
}

/** Badge du prochain épisode : « Ép. 7 dans 2 j 4 h ». L'horaire passé (fiche pas encore à jour) : « Ép. 7 sorti ». */
export function airingLabel(next: NonNullable<Media['nextAiring']>, now: number): string {
  const ms = next.airingAt * 1000 - now
  return ms <= 0 ? `Ép. ${next.episode} sorti` : `Ép. ${next.episode} dans ${formatCountdown(ms)}`
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '’', nbsp: ' ', '#39': '’', '#x27': '’',
}

/** Synopsis AniList en texte brut : sans balises, sans spoilers (~!…!~), sans mention de source. */
export function cleanSynopsis(raw: string | null, maxChars = Number.POSITIVE_INFINITY): string {
  if (!raw) return ''
  const text = raw
    .replace(/~![\s\S]*?!~/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 0)) || cut}…`
}

const GENRE_LABEL: Record<string, string> = {
  Adventure: 'Aventure',
  Comedy: 'Comédie',
  Drama: 'Drame',
  Horror: 'Horreur',
  Music: 'Musique',
  Mystery: 'Mystère',
  Psychological: 'Psychologique',
  'Sci-Fi': 'Science-fiction',
  'Slice of Life': 'Tranche de vie',
  Sports: 'Sport',
  Supernatural: 'Surnaturel',
}
export const genreLabel = (genre: string): string => GENRE_LABEL[genre] ?? genre

/** Heures lisibles : « 128 h », « 3,5 h », « 45 min ». */
export function formatHours(minutes: number): string {
  if (minutes <= 0) return '0 h'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  return `${hours.toLocaleString('fr-FR', { maximumFractionDigits: hours < 10 ? 1 : 0 })} h`
}

const AIRING_LABEL: Record<string, string> = {
  FINISHED: 'Terminé', RELEASING: 'En diffusion', NOT_YET_RELEASED: 'À venir', CANCELLED: 'Annulé', HIATUS: 'En pause',
}

/** Statut de l'anime entier : en diffusion dès qu'une saison l'est, sinon celui de sa dernière saison sortie. */
export function animeAiringLabel(seasons: Pick<Media, 'status'>[]): string | null {
  if (seasons.some((m) => m.status === 'RELEASING')) return AIRING_LABEL.RELEASING!
  const released = seasons.filter((m) => m.status && m.status !== 'NOT_YET_RELEASED')
  const status = (released[released.length - 1] ?? seasons[seasons.length - 1])?.status
  return status ? AIRING_LABEL[status] ?? null : null
}

const oneDecimal = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** averageScore AniList (sur 100) ramené sur 5 : « 4,1 / 5 · communauté ». */
export const communityScore = (averageScore: number | null): string | null =>
  averageScore ? `${oneDecimal(averageScore / 20)} / 5 · communauté` : null

/** Note d'un épisode, déjà sur 5 chez Jikan. */
export const episodeScore = (score: number | null | undefined): string | null =>
  score ? `${oneDecimal(score)} / 5 · communauté` : null

/** « S01 | E07 » */
export const seasonEpisodeLabel = (season: number, episode: number): string =>
  `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`

const shortDate = (t: number, withYear: boolean) =>
  new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })

export const airedLine = (t: number): string => `Sorti le ${shortDate(t, true)}`
export const upcomingLine = (t: number, now: number): string => `Sort le ${shortDate(t, false)} · dans ${formatCountdown(t - now)}`

/** Dates d'un visionnage : « 12 mars 2025 – 20 mars 2025 », « date inconnue ». */
export function viewingDates({ startedAt, endedAt }: { startedAt: number | null; endedAt: number | null }): string {
  if (startedAt === null && endedAt === null) return 'date inconnue'
  if (startedAt === null || endedAt === null || startedAt === endedAt) return shortDate((endedAt ?? startedAt)!, true)
  return `${shortDate(startedAt, true)} – ${shortDate(endedAt, true)}`
}
