/**
 * @module web/e2e/helpers
 * Steps the offline tests share (3c).
 */

import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './fixtures';

/** Add a recipe through the API, as another device would. */
export async function addRecipe(request: APIRequestContext, name: string) {
    const response = await request.post('/api/recipes', { data: { name } });
    expect(response.status()).toBe(201);
}

/** Open the app and wait until it can start offline: the service worker controls it, and the copy is stored. */
export async function openAndSaveCopy(page: Page, recipes: string) {
    await page.goto('/options');
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(page.getByRole('region', { name: 'Offline copy' })).toContainText(`${recipes} on this device`);
}

/** The banner shown while a page reads the offline copy. */
export const offlineBanner = (page: Page) =>
    page.getByRole('status').filter({ hasText: 'Showing the copy saved on this device' });
