import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/capture-card-player/' : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Capture Card Player',
        short_name: 'Capture Player',
        description: 'View and listen to a connected capture card directly in your browser.',
        theme_color: '#363a4f',
        background_color: '#363a4f',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: `${process.env.NODE_ENV === 'production' ? '' : '/'}pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${process.env.NODE_ENV === 'production' ? '' : '/'}pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${process.env.NODE_ENV === 'production' ? '' : '/'}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the app shell — don't try to cache the live media stream
        globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
      },
    }),
  ],
});
