// playwright.config.ts — end-to-end tests for the Mise en place web client
//
// The tests drive real browsers against the real API, which serves the built
// client, on a _test database (T1). Build both first:
//   npm run build && npm run web:build    (from the repo root)
//   npm run e2e
// Firefox is the phone's engine; Chromium covers everything else. Each runs at
// a phone size and a desktop size (technical spec §5.6).

import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

// Like the API's tests, .env.test wins over anything already in the environment,
// so a shell with the dev .env loaded can't point these at the dev database.
// In CI there's no .env.test, and the workflow's DATABASE_URL is used.
if (existsSync('../.env.test')) {
    Object.assign(process.env, parseEnv(readFileSync('../.env.test', 'utf8')));
}

const databaseUrl = process.env.DATABASE_URL ?? '';
const database = databaseUrl ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) : '';
if (!database.endsWith('_test')) {
    throw new Error(
        `Refusing to run end-to-end tests against database "${database}": only names ending in _test are allowed.`,
    );
}

// A port of its own, so a dev server on 3000 doesn't get in the way
const PORT = 3100;
const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };

export default defineConfig({
    testDir: './e2e',
    // The tests share one database, so they run one at a time
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    globalSetup: './e2e/global-setup.ts',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'on-first-retry',
    },
    projects: [
        // Playwright can't emulate a mobile device in Firefox, so the phone size is the viewport alone
        { name: 'firefox-phone', use: { ...devices['Desktop Firefox'], viewport: phone } },
        { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: desktop } },
        { name: 'chromium-phone', use: { ...devices['Pixel 7'] } },
        { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: desktop } },
    ],
    webServer: {
        command: 'node dist/src/server.js',
        cwd: '..',
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { ...process.env, PORT: String(PORT), DATABASE_URL: databaseUrl, NODE_ENV: 'test' } as Record<string, string>,
    },
});
