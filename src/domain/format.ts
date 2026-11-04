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
