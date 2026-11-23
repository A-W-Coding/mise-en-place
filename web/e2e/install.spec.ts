/**
 * @module web/e2e/install
 * Installing the app (Step 13): the manifest, the service worker, and opening
 * with no connection.
 */

import { expect, test } from './fixtures';

interface ManifestIcon {
    src: string;
    sizes: string;
    type: string;
    purpose?: string;
}

test('the manifest describes an installable app, and its icons load', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');

    const response = await request.get(href!);
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = (await response.json()) as { icons: ManifestIcon[] };
    expect(manifest).toMatchObject({
        name: 'Mise en place',
        short_name: 'Mise en place',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1f7a5c',
        background_color: '#ffffff',
    });
    expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? 'any'}`)).toEqual([
        '192x192 any',
        '512x512 any',
        '512x512 maskable',
    ]);

    for (const icon of manifest.icons) {
        const image = await request.get(icon.src);
        expect(image.status(), icon.src).toBe(200);
        expect(image.headers()['content-type']).toBe('image/png');
    }
});

test('the service worker registers, and the app then opens with no connection', async ({ page, context, baseURL }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${baseURL}/`);
    // It takes control of the open page once it's ready
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    try {
        // A fresh start of a deep link, with no network: the app's files come from the service worker
        await page.goto('/options');
        await expect(page.getByRole('heading', { level: 1, name: 'Options' })).toBeVisible();
        await expect(page.getByText("Can't reach the server", { exact: true })).toBeVisible();
    } finally {
        await context.setOffline(false);
    }
});

test('Chromium finds it installable', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', "The installability check is Chromium's own");

    await page.goto('/');
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');

    // A test browser context is like a private window, which Chromium won't install from;
    // everything about the app itself must pass
    expect(installabilityErrors.filter((error) => error.errorId !== 'in-incognito')).toEqual([]);
});
