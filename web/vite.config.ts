// vite.config.ts — the Mise en place web client
// `npm run dev` serves the client on port 5173 and forwards /api and /media to
// the API on port 3000, so development is same-origin like production (F1).
// The `test` block configures Vitest, which reuses this config.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        react(),
        // The app installs from the browser (Step 13). The service worker caches the
        // app's own files, so it opens with no connection; the offline copy (3c) has the
        // recipes, and from 3b the worker keeps their photos too.
        // It's built only for production: `npm run dev` has none, so nothing is stale.
        VitePWA({
            // A new deploy takes over as soon as it's downloaded, and the page reloads
            // into it once, right after the app starts (see main.tsx)
            registerType: 'autoUpdate',
            injectRegister: false,
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
                name: 'Mise en place',
                short_name: 'Mise en place',
                description: 'Your recipes, ready while you cook.',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#1f7a5c',
                icons: [
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
            },
            workbox: {
                // Everything the app needs to start, fonts and icons included
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                // Any page address opens the app, offline too; the API and images never do
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/media(\/|$)/],
                cleanupOutdatedCaches: true,
                // Take over open pages as soon as a worker is ready: the first visit works
                // offline without a second start, and an update can reload into itself
                clientsClaim: true,
                skipWaiting: true,
                // Recipe photos (3b): a file never changes, since a new upload gets a new id,
                // so a cached one is always right. The cache names match src/images/media.ts,
                // which fills the thumbnails ahead of time and drops deleted photos' files
                runtimeCaching: [
                    {
                        // Every thumbnail, kept until its photo is deleted
                        urlPattern: /\/media\/[0-9a-f-]+-thumb\.webp$/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'mise-en-place-thumbnails',
                            cacheableResponse: { statuses: [200] },
                        },
                    },
                    {
                        // Full photos as they're viewed, the most recent 100
                        urlPattern: /\/media\/[0-9a-f-]+\.webp$/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'mise-en-place-images',
                            cacheableResponse: { statuses: [200] },
                            expiration: { maxEntries: 100 },
                        },
                    },
                ],
            },
        }),
    ],
    server: {
        port: 5173,
        strictPort: true,
        // The client imports shared/ (units, quantities) from outside web/
        fs: { allow: ['..'] },
        proxy: {
            '/api': 'http://localhost:3000',
            '/media': 'http://localhost:3000',
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'],
    },
});
