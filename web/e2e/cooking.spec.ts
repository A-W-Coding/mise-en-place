/**
 * @module web/e2e/cooking
 * Cooking mode, timers and printing (Step 13), on the seeded Beef Chili.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function openBeefChili(page: Page) {
    await page.goto('/');
    await page.getByRole('link', { name: /Beef Chili/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
}

test('cooking mode turns on and off, asking for and releasing the wake lock', async ({ page }) => {
    // A stand-in wake lock: a headless browser may refuse the real one, and this one can be counted
    await page.addInitScript(() => {
        const counts = { requests: 0, releases: 0 };
        Object.assign(window, { wakeLockCounts: counts });
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: {
                request: async () => {
                    counts.requests += 1;
                    const sentinel = {
                        released: false,
                        release: async () => {
                            sentinel.released = true;
                            counts.releases += 1;
                        },
                        addEventListener() {},
                        removeEventListener() {},
                    };
                    return sentinel;
                },
            },
        });
    });
    const counts = () => page.evaluate(() => (window as unknown as { wakeLockCounts: object }).wakeLockCounts);

    await openBeefChili(page);
    const panel = page.getByRole('region', { name: 'Cooking mode' });
    const toggle = panel.getByRole('switch', { name: 'Cooking mode' });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(panel).toContainText('On: the screen stays on');
    expect(await counts()).toEqual({ requests: 1, releases: 0 });
    // The page itself doesn't change
    await expect(page.getByRole('region', { name: 'Method' }).getByRole('listitem')).toHaveCount(14);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(panel).toContainText('Keeps the screen on');
    expect(await counts()).toEqual({ requests: 1, releases: 1 });
});

test('two timers run at once, and the one that ends is dismissed', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-23T12:00:00') });
    await openBeefChili(page);

    for (const [label, preset] of [
        ['Stir', '5 min'],
        ['Rice', '10 min'],
    ]) {
        await page.getByRole('button', { name: 'Timer', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: 'New timer' });
        await sheet.getByLabel('Label (optional)').fill(label);
        await sheet.getByRole('button', { name: preset, exact: true }).click();
        await sheet.getByRole('button', { name: `Start ${parseInt(preset)}-minute timer` }).click();
        await expect(sheet).toBeHidden();
    }

    const timers = page.getByRole('region', { name: 'Timers' });
    await expect(timers).toContainText('Stir 5:00');
    await expect(timers).toContainText('Rice 10:00');

    await page.clock.fastForward('05:01');

    const done = timers.getByRole('alert');
    await expect(done).toHaveText("Stir: time's upDismiss");
    await expect(timers).toContainText('Rice 4:59');

    await done.getByRole('button', { name: 'Dismiss' }).click();
    await expect(done).toBeHidden();
    await expect(timers).toContainText('Rice');

    // The chips stay on other pages too
    await page.getByRole('link', { name: 'Back to Recipes' }).click();
    await expect(page.getByRole('region', { name: 'Timers' })).toContainText('Rice');
});

test('printing shows only the name, ingredients and method', async ({ page }) => {
    await openBeefChili(page);
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });

    await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ingredients' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Method' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Mise en place' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Back to Recipes' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Cooking mode' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'More options for Beef Chili' })).toBeHidden();

    // Black on white, even when the screen is dark
    const colours = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return [style.backgroundColor, style.color];
    });
    expect(colours).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
});
