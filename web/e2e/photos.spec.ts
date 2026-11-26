/**
 * @module web/e2e/photos
 * A recipe's photos (3b, Step 25): upload two, make the second the main
 * photo, see its thumbnail on the list, then go offline and still see it.
 * The photos are small files in `fixtures/`, made with sharp. Each test
 * starts from the base seed: Beef Chili, with no photos.
 */

import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { offlineBanner, openAndSaveCopy } from './helpers';

const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);

/** Whether an image has loaded and has pixels: a missing or broken one has none. */
const loaded = (image: Locator) => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0);

test('upload photos, make one the main photo, see its thumbnail on the list, and still see it offline', async ({
    page,
    context,
    request,
}) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Beef Chili/ }).click();
    await page.getByRole('link', { name: 'Add photos' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();

    // Two at once, as a phone's picker can send them
    await page.getByLabel('Add photo').setInputFiles([fixture('chili.jpg'), fixture('bowl.png')]);
    await expect(page.getByText('2 of 10')).toBeVisible();
    const photos = page.getByRole('list', { name: 'Photos' }).getByRole('listitem');
    await expect(photos).toHaveCount(2);
    await expect(photos.nth(0)).toContainText('Main');
    await expect.poll(() => loaded(photos.nth(1).locator('img'))).toBe(true);

    // The second becomes the main photo
    await page.getByRole('button', { name: 'Options for Photo 2 of Beef Chili' }).click();
    await page.getByRole('menuitem', { name: 'Make main photo' }).click();
    await expect(photos.nth(1)).toContainText('Main');
    await expect(photos.nth(0)).not.toContainText('Main');

    const recipes = (await (await request.get('/api/recipes')).json()) as { id: string; name: string; primaryImageId: string }[];
    const chili = recipes.find((recipe) => recipe.name === 'Beef Chili')!;
    const recipe = (await (await request.get(`/api/recipes/${chili.id}`)).json()) as { images: { id: string }[] };
    expect(chili.primaryImageId).toBe(recipe.images[1]!.id);

    // It heads the recipe page, which says how many there are
    await page.getByRole('link', { name: 'Back to Beef Chili' }).click();
    const header = page.getByRole('link', { name: "Beef Chili's photos: 2 photos" });
    await expect(header.locator('img')).toHaveAttribute('src', `/media/${chili.primaryImageId}.webp`);
    await expect.poll(() => loaded(header.locator('img'))).toBe(true);

    // Its thumbnail is the list's
    await page.getByRole('link', { name: 'Back to Recipes' }).click();
    const thumbnail = page.getByRole('link', { name: /Beef Chili/ }).locator('img');
    await expect(thumbnail).toHaveAttribute('src', `/media/${chili.primaryImageId}-thumb.webp`);
    await expect.poll(() => loaded(thumbnail)).toBe(true);

    // Offline: the service worker has every thumbnail, put there after the copy refreshed
    await openAndSaveCopy(page, '1 recipe');
    await expect
        .poll(() => page.evaluate(async () => (await (await caches.open('mise-en-place-thumbnails')).keys()).length))
        .toBe(2);
    await context.setOffline(true);
    try {
        await page.goto('/');
        await expect(offlineBanner(page)).toBeVisible();
        const offlineThumbnail = page.getByRole('link', { name: /Beef Chili/ }).locator('img');
        await expect(offlineThumbnail).toHaveAttribute('src', `/media/${chili.primaryImageId}-thumb.webp`);
        await expect.poll(() => loaded(offlineThumbnail)).toBe(true);

        // And the Photos page says adding one needs a connection
        await page.getByRole('link', { name: /Beef Chili/ }).click();
        await page.getByRole('link', { name: "Beef Chili's photos: 2 photos" }).click();
        await expect(page.getByText(/Adding a photo needs a connection to the server/)).toBeVisible();
        await expect(page.getByLabel('Add photo')).toBeDisabled();
    } finally {
        await context.setOffline(false);
    }
});

test('a refused file is named in its message, and deleting the main photo asks first', async ({ page, request }) => {
    const recipes = (await (await request.get('/api/recipes')).json()) as { id: string; name: string }[];
    const chili = recipes.find((recipe) => recipe.name === 'Beef Chili')!;
    await page.goto(`/recipes/${chili.id}/photos`);
    await expect(page.getByText('0 of 10')).toBeVisible();

    await page.getByLabel('Add photo').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photo') });
    await expect(page.getByRole('alert')).toContainText("notes.jpg wasn't added. Only JPEG, PNG and WebP images are accepted.");

    await page.getByLabel('Add photo').setInputFiles(fixture('chili.jpg'));
    await expect(page.getByText('1 of 10')).toBeVisible();
    await page.getByRole('button', { name: 'Options for Photo 1 of Beef Chili' }).click();
    await page.getByRole('menuitem', { name: 'Delete photo…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete this photo?' });
    await dialog.getByRole('button', { name: 'Delete photo' }).click();

    await expect(page.getByText('0 of 10')).toBeVisible();
    await expect(page.getByText(/No photos yet/)).toBeVisible();
});
