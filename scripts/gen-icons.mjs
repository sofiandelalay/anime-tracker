// Génère les icônes et écrans de démarrage depuis design/icone-anime-1024.png.
// Usage : npm run icons (sharp est installé le temps du script, jamais ajouté au projet).
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const SOURCE = 'design/icone-anime-1024.png'
const ICON_BG = '#171715'

mkdirSync('public/icons', { recursive: true })
mkdirSync('public/splash', { recursive: true })

const ICONS = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
  'icon-512-maskable.png': 512, // le dessin tient déjà dans la zone de sécurité
}
for (const [file, size] of Object.entries(ICONS)) {
  await sharp(SOURCE)
    .resize(size, size, { kernel: 'lanczos3' })
    .flatten({ background: ICON_BG }) // iOS noircit toute transparence
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(`public/icons/${file}`)
}

// iPhone 17 Pro : 402 × 874 pt @3x = 1206 × 2622 px. L'icône arrondie, centrée, sur le fond du thème.
const TILE = 360
const roundedCorners = Buffer.from(`<svg width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="80" ry="80"/></svg>`)
const tile = await sharp(SOURCE)
  .resize(TILE, TILE, { kernel: 'lanczos3' })
  .composite([{ input: roundedCorners, blend: 'dest-in' }])
  .png()
  .toBuffer()
for (const [name, background] of Object.entries({ light: '#f4f4f2', dark: '#141416' })) {
  await sharp({ create: { width: 1206, height: 2622, channels: 3, background } })
    .composite([{ input: tile, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(`public/splash/splash-1206x2622-${name}.png`)
}
console.log('Icônes et écrans de démarrage générés.')
