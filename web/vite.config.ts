// vite.config.ts — the Mise en place web client
// `npm run dev` serves the client on port 5173 and forwards /api and /media to
// the API on port 3000, so development is same-origin like production (F1).
// The `test` block configures Vitest, which reuses this config.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
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
