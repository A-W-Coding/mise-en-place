/**
 * @module web/e2e/recipes
 * Reading recipes, and keeping devices in step (Step 11). Each test starts
 * from the base seed: Beef Chili and its ingredients.
 */

import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function addRecipe(request: APIRequestContext, name: string) {
    const response = await request.post('/api/recipes', { data: { name } });
    expect(response.status()).toBe(201);
}

/**
 * What the browser reports when you switch back to the app from another app
 * or tab: the page was hidden and is visible again. A headless browser never
 * hides its page, so this plays the two events.
 */
async function comeBackToTheApp(page: Page) {
    await page.evaluate(() => {
        for (const state of ['hidden', 'visible'] as const) {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
            // The browser's own event bubbles to window, which is where TanStack Query listens
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        }
    });
}

test('find a recipe by search, read it, and go back to the search', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('chili');
    await expect(page).toHaveURL(/\/\?q=chili$/);

    await page.getByRole('link', { name: /Beef Chili/ }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
    await expect(page).toHaveTitle('Beef Chili · Mise en place');
    const lines = page.getByRole('region', { name: 'Ingredients' }).getByRole('listitem');
    await expect(lines).toHaveCount(10);
    await expect(lines.filter({ hasText: 'beef mince' })).toContainText('500 g');
    await expect(lines.filter({ hasText: 'smoked paprika' })).toContainText('1–2 tsp');
    await expect(lines.filter({ hasText: 'red pepper' })).toContainText('½');
    await expect(page.getByRole('region', { name: 'Method' }).getByRole('listitem')).toHaveCount(14);

    await page.getByRole('link', { name: 'Back to Recipes' }).click();
    await expect(page).toHaveURL(/\/\?q=chili$/);
    await expect(page.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('chili');
});

test('the list loads the next page as you scroll', async ({ page, request }) => {
    for (let n = 1; n <= 25; n++) await addRecipe(request, `Test recipe ${String(n).padStart(2, '0')}`);
    const offsets: string[] = [];
    page.on('request', (req) => {
        const url = new URL(req.url());
        if (url.pathname === '/api/recipes') offsets.push(url.searchParams.get('offset') ?? '');
    });

    await page.goto('/');
    await expect(page.getByText('26 recipes')).toBeVisible();
    const rows = page.getByRole('list', { name: 'Recipes' }).getByRole('listitem');

    // Scroll to the last row until the rest arrive
    await expect(async () => {
        await rows.last().scrollIntoViewIfNeeded();
        await expect(rows).toHaveCount(26, { timeout: 1000 });
    }).toPass();
    await expect(rows.last()).toContainText('Test recipe 25');
    expect(offsets).toEqual(['0', '20']);
});

test('a recipe added on another device appears when the app comes back to the front, and on Refresh', async ({
    page,
    browser,
    baseURL,
}) => {
    // `page` is the phone; a second browser context stands in for the laptop
    const laptop = await browser.newContext({ baseURL });
    try {
        await page.goto('/');
        await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();

        await addRecipe(laptop.request, 'Lemon Drizzle Cake');
        await comeBackToTheApp(page);
        await expect(page.getByRole('link', { name: /Lemon Drizzle Cake/ })).toBeVisible();

        await addRecipe(laptop.request, 'Mushroom Risotto');
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(page.getByRole('link', { name: /Mushroom Risotto/ })).toBeVisible();
        await expect(page.getByText('3 recipes')).toBeVisible();
    } finally {
        await laptop.close();
    }
});

test('a recipe deleted on another device says so when the app comes back to the front', async ({
    page,
    browser,
    baseURL,
}) => {
    const laptop = await browser.newContext({ baseURL });
    try {
        await page.goto('/');
        await page.getByRole('link', { name: /Beef Chili/ }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();

        const id = new URL(page.url()).pathname.split('/').pop();
        expect((await laptop.request.delete(`/api/recipes/${id}`)).ok()).toBe(true);
        await comeBackToTheApp(page);

        await expect(page.getByRole('heading', { level: 1, name: 'This recipe was deleted' })).toBeVisible();
        await page.getByRole('link', { name: 'Back to recipes' }).click();
        await expect(page.getByText('No recipes yet')).toBeVisible();
    } finally {
        await laptop.close();
    }
});

test('the theme chosen in Options stays chosen on this device', async ({ page }) => {
    await page.goto('/options');
    await expect(page.getByText('Server reachable')).toBeVisible();

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
});
