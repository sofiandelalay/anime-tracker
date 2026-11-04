import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Chemin de base configurable (GitHub Pages : VITE_BASE=/anime-tracker/)
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'splash/*.png'],
      manifest: {
        name: 'Mes animes',
        short_name: 'Animes',
        description: 'Mon suivi d’animes, épisode par épisode.',
        lang: 'fr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f4f2',
        theme_color: '#f4f4f2',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Jaquettes AniList : jamais en IndexedDB, uniquement ici.
            urlPattern: ({ url }) => /(^|\.)anilist\.co$|(^|\.)anili\.st$/.test(url.hostname) && url.pathname.includes('/media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'covers',
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: true },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
})
