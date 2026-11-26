/**
 * @module web/e2e/helpers
 * Steps and checks the tests share: the offline ones (3c), and where a
 * picker's suggestions open (Step 26).
 */

import type { APIRequestContext, Locator, Page } from '@playwright/test';
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

/**
 * Check a picker's suggestions open just under its box. Placed against the
 * page instead, as the tag box's were until Step 26, they open below the
 * bottom of the screen, where a phone never shows them; a test's click still
 * reaches them, since Playwright scrolls to whatever it clicks.
 */
export async function expectJustUnder(suggestions: Locator, box: Locator) {
    await expect(suggestions).toBeVisible();
    const list = (await suggestions.boundingBox())!;
    const field = (await box.boundingBox())!;
    const gap = list.y - (field.y + field.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(12);
}

/** The banner shown while a page reads the offline copy. */
export const offlineBanner = (page: Page) =>
    page.getByRole('status').filter({ hasText: 'Showing the copy saved on this device' });
