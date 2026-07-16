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
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        file_handlers: [
          {
            action: '/',
            accept: {
              'text/csv': ['.csv', '.tsv'],
              'application/json': ['.json']
            }
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      },
      devOptions: { enabled: true }
    })
  ],
  build: {
    target: 'esnext',
    minify: 'oxc'
  }
});
