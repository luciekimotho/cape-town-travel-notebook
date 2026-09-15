import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/cape-town-travel-notebook/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Cape Town Travel Notebook',
      short_name: 'Cape Town',
      description: 'A private, local-first Cape Town travel notebook.',
      theme_color: '#008c95',
      background_color: '#fff4de',
      display: 'standalone',
      start_url: '/cape-town-travel-notebook/',
      scope: '/cape-town-travel-notebook/',
      icons: [
        { src: '/cape-town-travel-notebook/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/cape-town-travel-notebook/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/cape-town-travel-notebook/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      navigateFallback: 'index.html',
      runtimeCaching: [],
    },
  })],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
