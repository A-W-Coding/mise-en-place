/**
 * @module web/e2e/offline
 * The offline copy (Step 16): reading recipes, searching and cooking with no
 * connection, after a fresh start too; catching up once the connection comes
 * back; and retrying a refresh that failed. Each test starts from the base
 * seed: Beef Chili and its ingredients.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addRecipe, offlineBanner as banner, openAndSaveCopy } from './helpers';

/** A stand-in wake lock: a headless browser may refuse the real one. */
async function standInWakeLock(page: Page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: {
                request: async () => ({
                    released: false,
                    release: async () => {},
                    addEventListener() {},
                    removeEventListener() {},
                }),
            },
        });
    });
}

/** Search the list, open Beef Chili, and turn on cooking mode. */
async function searchAndCook(page: Page) {
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('chil');
    await expect(page.getByText('1 match')).toBeVisible();
    await page.getByRole('link', { name: /Beef Chili/ }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ingredients' }).getByRole('listitem')).toHaveCount(10);
    await expect(page.getByRole('region', { name: 'Method' }).getByRole('listitem')).toHaveCount(14);
    const panel = page.getByRole('region', { name: 'Cooking mode' });
    await panel.getByRole('switch', { name: 'Cooking mode' }).click();
    await expect(panel).toContainText('On: the screen stays on');
}

test('with no connection, recipes open, search works and cooking mode turns on, after a fresh start too', async ({
    page,
    context,
}) => {
    await standInWakeLock(page);
    await openAndSaveCopy(page, '1 recipe');

    await context.setOffline(true);
    try {
        // In the open app
        await page.getByRole('link', { name: 'Back to Recipes' }).click();
        await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();
        await expect(banner(page)).toContainText(
            "Can't reach the server. Showing the copy saved on this device, refreshed just now.",
        );
        await searchAndCook(page);

        // A fresh start, still offline: the app comes from the service worker, the recipes from the copy
        await page.goto('/');
        await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();
        await expect(banner(page)).toBeVisible();
        await searchAndCook(page);

        // The seed has 12 ingredients, two of them used by no recipe
        await page.goto('/options/ingredients');
        await expect(page.getByText('12 ingredients')).toBeVisible();
        await expect(banner(page)).toBeVisible();
    } finally {
        await context.setOffline(false);
    }
});

test('coming back online brings a change made elsewhere, with no restart', async ({ page, context, browser, baseURL }) => {
    const laptop = await browser.newContext({ baseURL });
    try {
        await openAndSaveCopy(page, '1 recipe');
        await page.getByRole('link', { name: 'Back to Recipes' }).click();
        await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();

        await context.setOffline(true);
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(banner(page)).toBeVisible();

        await addRecipe(laptop.request, 'Lemon Drizzle Cake');
        await context.setOffline(false);

        await expect(page.getByRole('link', { name: /Lemon Drizzle Cake/ })).toBeVisible();
        await expect(banner(page)).toBeHidden();
        await page.getByRole('link', { name: 'Options' }).click();
        await expect(page.getByRole('region', { name: 'Offline copy' })).toContainText('2 recipes on this device');
    } finally {
        await context.setOffline(false);
        await laptop.close();
    }
});

test.describe('a refresh that fails', () => {
    // So the test's own block on /api/sync sees every request: a service worker can hide them from it
    test.use({ serviceWorkers: 'block' });

    test('is retried, and the retry gets the new snapshot without a restart', async ({ page, browser, baseURL }) => {
        const laptop = await browser.newContext({ baseURL });
        try {
            await page.clock.install();
            await page.route('**/api/sync', (route) => route.abort('internetdisconnected'));

            await page.goto('/options');
            const section = page.getByRole('region', { name: 'Offline copy' });
            await expect(section).toContainText('Not saved yet');
            await expect(section).toContainText('The last refresh failed');

            await addRecipe(laptop.request, 'Lemon Drizzle Cake');
            await page.unroute('**/api/sync');
            await page.clock.runFor(15_000);

            await expect(section).toContainText('2 recipes on this device');
            await expect(section).not.toContainText('The last refresh failed');
        } finally {
            await laptop.close();
        }
    });
});

test.describe('a server slow to answer', () => {
    // So the test's own hold on /api/recipes sees every request: a service worker can hide them from it
    test.use({ serviceWorkers: 'block' });

    test('a fresh start shows the copy at once, rather than waiting for the request to give up', async ({ page }) => {
        await page.goto('/options');
        await expect(page.getByRole('region', { name: 'Offline copy' })).toContainText('1 recipe on this device');

        // As with Proton on: the request to the Pi takes seconds to fail
        await page.route(/\/api\/recipes(\?|$)/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            await route.abort('timedout').catch(() => {});
        });
        try {
            await page.goto('/');
            await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible({ timeout: 3_000 });
            // Nothing has failed yet, so no banner claims the server can't be reached
            await expect(banner(page)).toBeHidden();
        } finally {
            await page.unrouteAll({ behavior: 'ignoreErrors' });
        }
    });
});
