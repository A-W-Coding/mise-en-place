/**
 * @module web/e2e/offline-editing
 * Saving offline, and uploading (Step 17, D15): a new recipe and an edit made
 * with no connection wait on the device, survive a fresh start, and reach
 * another device by themselves once the connection is back; and a create
 * whose answer was lost isn't made twice. Each test starts from the base seed.
 */

import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { openAndSaveCopy } from './helpers';

/** The recipes the API holds with exactly this name. */
async function recipesNamed(request: APIRequestContext, name: string) {
    const response = await request.get('/api/recipes', { params: { search: name, limit: 100 } });
    const recipes = (await response.json()) as { id: string; name: string; description: string | null }[];
    return recipes.filter((recipe) => recipe.name === name);
}

const waitingNotice = 'Waiting to upload.';

test('offline, a new recipe and an edit wait on the device, survive a fresh start, and upload by themselves', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const laptop = await browser.newContext({ baseURL });
    try {
        await openAndSaveCopy(page, '1 recipe');
        await context.setOffline(true);

        // A new recipe, with an ingredient the server hasn't got
        await page.goto('/recipes/new');
        await page.getByLabel('Name').fill('Sourdough Toast');
        await page.getByLabel('Amount, line 1').fill('2');
        await page.getByRole('combobox', { name: 'Ingredient, line 1' }).fill('sourdough');
        await page.getByRole('option', { name: 'Create ingredient “sourdough”' }).click();
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Sourdough Toast' })).toBeVisible();
        await expect(page.getByText(waitingNotice, { exact: true })).toBeVisible();

        // An edit to another, opened from the offline copy
        await page.goto('/');
        await page.getByRole('link', { name: /Beef Chili/ }).click();
        // The ⋮ menu, which every screen size has
        await page.getByRole('button', { name: 'More options for Beef Chili' }).click();
        await page.getByRole('menuitem', { name: 'Edit' }).click();
        await page.getByLabel('Description').fill('Hotter, with chipotle.');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Hotter, with chipotle.')).toBeVisible();
        await expect(page.getByText(waitingNotice, { exact: true })).toBeVisible();

        // A fresh start, still offline: both are there, marked
        await page.goto('/');
        await expect(
            page.getByRole('list', { name: 'Waiting to upload' }).getByRole('link', { name: /Sourdough Toast/ }),
        ).toBeVisible();
        await expect(page.getByRole('list', { name: 'Recipes' }).getByRole('link', { name: /Beef Chili/ })).toContainText(
            'Waiting to upload',
        );
        expect(await recipesNamed(laptop.request, 'Sourdough Toast')).toEqual([]);

        // Back online, with no tap: both reach the laptop. Firefox's emulated
        // reconnect can need the app's retry, so allow time for one
        await context.setOffline(false);
        await expect
            .poll(async () => (await recipesNamed(laptop.request, 'Sourdough Toast')).length, { timeout: 20_000 })
            .toBe(1);
        await expect
            .poll(async () => (await recipesNamed(laptop.request, 'Beef Chili'))[0]?.description)
            .toBe('Hotter, with chipotle.');
        const [toast] = await recipesNamed(laptop.request, 'Sourdough Toast');
        const lines = (await (await laptop.request.get(`/api/recipes/${toast!.id}`)).json()) as {
            recipeIngredients: { quantity: number; ingredient: { name: string } }[];
        };
        expect(lines.recipeIngredients.map((line) => [line.quantity, line.ingredient.name])).toEqual([[2, 'sourdough']]);

        // And the marks go
        await expect(page.getByRole('list', { name: 'Waiting to upload' })).toBeHidden();
        await expect(page.getByRole('list', { name: 'Recipes' }).getByRole('link', { name: /Beef Chili/ })).not.toContainText(
            'Waiting to upload',
        );
    } finally {
        await context.setOffline(false);
        await laptop.close();
    }
});

test.describe('a lost answer', () => {
    // So the test's own handling of POST /api/recipes sees it: a service worker can hide requests from it
    test.use({ serviceWorkers: 'block' });

    test("a new recipe whose answer was lost isn't created twice when the upload is retried", async ({ page, request }) => {
        let lost = false;
        await page.route('**/api/recipes', async (route) => {
            if (route.request().method() !== 'POST' || lost) return route.fallback();
            lost = true;
            // It reaches the API, but the answer never comes back
            await route.fetch();
            await route.abort('connectionreset');
        });

        await page.goto('/recipes/new');
        await page.getByLabel('Name').fill('Lost Answer Pie');
        await page.getByRole('button', { name: 'Save' }).click();

        // With no answer, it's kept on the device, though it did arrive
        await expect(page.getByText(waitingNotice, { exact: true })).toBeVisible();
        expect(await recipesNamed(request, 'Lost Answer Pie')).toHaveLength(1);

        // The retry hears 409, finds it's this recipe, and counts it as uploaded
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(page.getByText(waitingNotice, { exact: true })).toBeHidden();
        await expect(page.getByRole('heading', { level: 1, name: 'Lost Answer Pie' })).toBeVisible();
        expect(await recipesNamed(request, 'Lost Answer Pie')).toHaveLength(1);
    });
});
