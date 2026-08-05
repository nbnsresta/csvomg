import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'csvomg',
        short_name: 'csvomg',
        description: 'Lean CSV & JSON editor. Open, edit, save.',
        theme_color: '#131620',
        background_color: '#131620',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'text/csv': ['.csv', '.tsv'],
              'application/json': ['.json']
            }
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // og-image.png (public/, used by <meta property="og:image">) is only ever fetched by
        // search engines and social-media unfurlers, never by the app itself in a real user's
        // browser — precaching its ~160KB into every install would be pure waste.
        globIgnores: ['og-image.png']
      },
      // Was `enabled: true` — that registers a service worker even under `npm run dev`, which
      // then serves whatever bundle/HTML it cached at registration time. Every rapid source
      // change (new DOM elements, updated main.ts wiring) risks silently going stale behind it
      // until a manual hard-refresh/unregister — this is what caused two separate "nothing
      // happens" reports (drag-drop/tabs, then the Save As dialog) that tested fine in a clean
      // browser. PWA/offline behavior should be verified via `npm run build && npm run preview`
      // instead, which is the standard way to test a real production service worker anyway.
      devOptions: { enabled: false }
    })
  ],
  build: {
    target: 'esnext',
    minify: 'oxc'
  }
});
