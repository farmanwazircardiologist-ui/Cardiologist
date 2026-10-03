import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Heart Clinic',
        short_name: 'Heart Clinic',
        description: 'Cardiology clinic: patients, visits, digital prescriptions, billing',
        theme_color: '#123a6b',
        background_color: '#f3f7fb',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // The whole app shell (including the lazy PDF chunk) is cached so the
        // app opens and works without internet.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  test: { environment: 'node', setupFiles: ['./tests/setup.js'], include: ['tests/**/*.test.{js,jsx}'] },
});
