import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (p: P): P => ({
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  ...p,
})

export const IconList = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="4" width="17" height="16" rx="3" /><path d="M8 9h8M8 12.5h8M8 16h5" /></svg>
)
export const IconCalendar = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
)
export const IconSparkles = (p: P) => (
  <svg {...base(p)}><path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
)
export const IconChart = (p: P) => (
  <svg {...base(p)}><path d="M5 20V12M10 20V6M15 20v-9M20 20V4" /></svg>
)
export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.6-4.6" /></svg>
)
export const IconGear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
export const IconMinus = (p: P) => <svg {...base(p)}><path d="M5 12h14" /></svg>
export const IconClose = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const IconCheck = (p: P) => <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
export const IconChevronLeft = (p: P) => <svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>
export const IconChevronDown = (p: P) => <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>
export const IconCloudOff = (p: P) => (
  <svg {...base(p)}><path d="M3 3l18 18M8.5 7.2A6 6 0 0 1 17.7 11 4 4 0 0 1 20 18M17 19H7a5 5 0 0 1-1.6-9.7" /></svg>
)
