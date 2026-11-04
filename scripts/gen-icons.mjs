// Génère les icônes et écrans de démarrage PNG sans dépendance (zlib natif).
// Usage : npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y)
      raw.set([r, g, b], row + 1 + x * 3)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// Marque : anneau + triangle « lecture », en coordonnées normalisées [-1, 1].
function markCoverage(u, v) {
  const r = Math.hypot(u, v)
  if (Math.abs(r - 0.62) < 0.05) return 1
  const p = [[-0.2, -0.3], [-0.2, 0.3], [0.32, 0]]
  const s1 = (p[1][0] - p[0][0]) * (v - p[0][1]) - (p[1][1] - p[0][1]) * (u - p[0][0])
  const s2 = (p[2][0] - p[1][0]) * (v - p[1][1]) - (p[2][1] - p[1][1]) * (u - p[1][0])
  const s3 = (p[0][0] - p[2][0]) * (v - p[2][1]) - (p[0][1] - p[2][1]) * (u - p[2][0])
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)
  return inside ? 1 : 0
}

function drawer({ w, h, bg, fg, cx, cy, size }) {
  const half = size / 2
  const SS = 4
  return (x, y) => {
    const base = hex(bg)
    if (Math.abs(x - cx) > half + 1 || Math.abs(y - cy) > half + 1) return base
    let cov = 0
    for (let i = 0; i < SS; i++)
      for (let j = 0; j < SS; j++) {
        const u = (x + (i + 0.5) / SS - cx) / half
        const v = (y + (j + 0.5) / SS - cy) / half
        cov += markCoverage(u, v)
      }
    return mix(base, hex(fg), cov / (SS * SS))
  }
}

const THEMES = {
  light: { bg: '#f4f4f2', fg: '#5b6470' },
  dark: { bg: '#141416', fg: '#c9ccd1' },
}
const ICON = { bg: '#2a2e35', fg: '#e9e7e2' }

mkdirSync('public/icons', { recursive: true })
mkdirSync('public/splash', { recursive: true })

const icon = (s, markRatio, file) =>
  writeFileSync(file, png(s, s, drawer({ w: s, h: s, ...ICON, cx: s / 2, cy: s / 2, size: s * markRatio })))

icon(192, 0.62, 'public/icons/icon-192.png')
icon(512, 0.62, 'public/icons/icon-512.png')
icon(512, 0.46, 'public/icons/icon-512-maskable.png')
icon(180, 0.62, 'public/icons/apple-touch-icon.png')

// iPhone 17 Pro : 402 × 874 pt @3x = 1206 × 2622 px
for (const [name, t] of Object.entries(THEMES)) {
  const w = 1206
  const h = 2622
  writeFileSync(`public/splash/splash-1206x2622-${name}.png`, png(w, h, drawer({ w, h, ...t, cx: w / 2, cy: h / 2, size: 300 })))
}
console.log('Icônes et écrans de démarrage générés.')
