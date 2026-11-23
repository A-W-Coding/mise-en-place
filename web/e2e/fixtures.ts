/**
 * @module web/e2e/fixtures
 * Playwright's `test`, extended so every test starts from the API's base seed
 * (Beef Chili and its ingredients), the same data the API's own tests use.
 * The seed refuses anything but a _test or _dev database.
 */

import { execSync } from 'node:child_process';
import { test as base } from '@playwright/test';

export const test = base.extend<{ baseSeed: void }>({
    baseSeed: [
        // Playwright requires an object pattern here, even an empty one
        // eslint-disable-next-line no-empty-pattern
        async ({}, use) => {
            execSync('npm run seed', { cwd: '..', env: process.env, stdio: 'ignore' });
            await use();
        },
        { auto: true },
    ],
});

export { expect } from '@playwright/test';
