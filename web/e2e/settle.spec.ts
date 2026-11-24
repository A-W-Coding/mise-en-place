/**
 * @module web/e2e/settle
 * When an upload can't go through (Step 18): Beef Chili is edited offline on
 * the phone while the laptop changes or deletes it, and each choice settles
 * it. Each test starts from the base seed.
 */

import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openAndSaveCopy } from './helpers';

interface RecipeOnServer {
    id: string;
    name: string;
    description: string | null;
}

async function recipesNamed(request: APIRequestContext, name: string): Promise<RecipeOnServer[]> {
    const response = await request.get('/api/recipes', { params: { search: name, limit: 100 } });
    return ((await response.json()) as RecipeOnServer[]).filter((recipe) => recipe.name === name);
}

/**
 * Edit Beef Chili's description offline on the phone ("Mine."), let the
 * laptop do `elsewhere` to it meanwhile, then come back online and refresh,
 * so the upload meets the laptop's change.
 */
async function meetChangeElsewhere(
    page: Page,
    context: BrowserContext,
    laptop: APIRequestContext,
    elsewhere: (id: string) => Promise<void>,
) {
    await openAndSaveCopy(page, '1 recipe');
    const [chili] = await recipesNamed(laptop, 'Beef Chili');

    await context.setOffline(true);
    await page.goto(`/recipes/${chili!.id}`);
    await page.getByRole('button', { name: 'More options for Beef Chili' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByLabel('Description').fill('Mine.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Waiting to upload.', { exact: true })).toBeVisible();

    await elsewhere(chili!.id);

    await context.setOffline(false);
    await page.getByRole('button', { name: 'Refresh' }).click();
    // Firefox's emulated reconnect can need the app's retry
    await expect(page.getByRole('region', { name: 'Needs your attention' })).toBeVisible({ timeout: 20_000 });
    return chili!.id;
}

const changeIt = (laptop: APIRequestContext) => async (id: string) => {
    const response = await laptop.patch(`/api/recipes/${id}`, { data: { description: 'Theirs.' } });
    expect(response.status()).toBe(200);
};

const deleteIt = (laptop: APIRequestContext) => async (id: string) => {
    expect((await laptop.delete(`/api/recipes/${id}`)).ok()).toBe(true);
};

/** Choose in the panel, then confirm in the dialog that asks first. */
async function chooseAndConfirm(page: Page, choice: string, dialog: string, confirm: string) {
    await page.getByRole('region', { name: 'Needs your attention' }).getByRole('button', { name: choice }).click();
    await page.getByRole('alertdialog', { name: dialog }).getByRole('button', { name: confirm }).click();
}

test.describe('a recipe changed on the laptop while edited offline on the phone', () => {
    test('shows both versions, and Keep mine saves the phone’s over the laptop’s', async ({
        page,
        context,
        browser,
        baseURL,
    }) => {
        const laptop = await browser.newContext({ baseURL });
        try {
            await meetChangeElsewhere(page, context, laptop.request, changeIt(laptop.request));
            const panel = page.getByRole('region', { name: 'Needs your attention' });
            await expect(page.getByText('Mine.', { exact: true })).toBeVisible();
            await panel.getByRole('button', { name: 'Theirs', exact: true }).click();
            await expect(page.getByText('Theirs.', { exact: true })).toBeVisible();

            await chooseAndConfirm(page, 'Keep mine', 'Save yours over theirs?', 'Keep mine');

            await expect.poll(async () => (await recipesNamed(laptop.request, 'Beef Chili'))[0]?.description).toBe('Mine.');
            await expect(panel).toBeHidden();
        } finally {
            await context.setOffline(false);
            await laptop.close();
        }
    });

    test('Keep theirs drops the phone’s version', async ({ page, context, browser, baseURL }) => {
        const laptop = await browser.newContext({ baseURL });
        try {
            await meetChangeElsewhere(page, context, laptop.request, changeIt(laptop.request));

            await chooseAndConfirm(page, 'Keep theirs', 'Keep theirs, and discard yours?', 'Discard mine');

            await expect(page.getByText('Theirs.', { exact: true })).toBeVisible();
            await expect(page.getByRole('region', { name: 'Needs your attention' })).toBeHidden();
            expect((await recipesNamed(laptop.request, 'Beef Chili'))[0]?.description).toBe('Theirs.');
        } finally {
            await context.setOffline(false);
            await laptop.close();
        }
    });

    test('Keep both saves the phone’s version as a copy, beside the laptop’s', async ({
        page,
        context,
        browser,
        baseURL,
    }) => {
        const laptop = await browser.newContext({ baseURL });
        try {
            await meetChangeElsewhere(page, context, laptop.request, changeIt(laptop.request));

            await page.getByRole('region', { name: 'Needs your attention' }).getByRole('button', { name: 'Keep both' }).click();

            await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili (copy)' })).toBeVisible();
            await expect.poll(async () => (await recipesNamed(laptop.request, 'Beef Chili (copy)'))[0]?.description).toBe('Mine.');
            expect((await recipesNamed(laptop.request, 'Beef Chili'))[0]?.description).toBe('Theirs.');
        } finally {
            await context.setOffline(false);
            await laptop.close();
        }
    });
});

test('a recipe deleted on the laptop while edited offline on the phone can be saved as a new one', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const laptop = await browser.newContext({ baseURL });
    try {
        const oldId = await meetChangeElsewhere(page, context, laptop.request, deleteIt(laptop.request));
        await expect(page.getByRole('region', { name: 'Needs your attention' })).toContainText('deleted on another device');

        await page.getByRole('region', { name: 'Needs your attention' }).getByRole('button', { name: 'Save as a new recipe' }).click();

        await expect.poll(async () => (await recipesNamed(laptop.request, 'Beef Chili'))[0]?.description).toBe('Mine.');
        const [revived] = await recipesNamed(laptop.request, 'Beef Chili');
        expect(revived?.id).not.toBe(oldId);
        await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Needs your attention' })).toBeHidden();
    } finally {
        await context.setOffline(false);
        await laptop.close();
    }
});
