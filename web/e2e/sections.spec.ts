/**
 * @module web/e2e/sections
 * A method in sections, with a timer on a step, and ingredient lines grouped
 * by section (3b, Step 22), made in the editor and used on the recipe page.
 */

import { expect, test } from './fixtures';

test("a recipe with two sections, a step's timer and grouped lines; the timer starts from its page", async ({ page }) => {
    await page.clock.install();
    await page.goto('/recipes/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
    await page.getByLabel('Name').fill('Chilli Bowl');

    // Two lines, picked from the seeded ingredients
    await page.getByLabel('Amount, line 1').fill('2');
    await page.getByRole('combobox', { name: 'Ingredient, line 1' }).fill('onio');
    await page.getByRole('option', { name: 'onion' }).click();
    await page.getByRole('button', { name: 'Add ingredient' }).click();
    await page.getByLabel('Amount, line 2').fill('1 can');
    await page.getByRole('combobox', { name: 'Ingredient, line 2' }).fill('kidney');
    await page.getByRole('option', { name: 'kidney beans' }).click();

    // The first section: renamed, its steps typed straight through, Enter starting each next one
    await page.getByRole('textbox', { name: 'Section 1', exact: true }).fill('Chilli');
    await page.getByRole('textbox', { name: 'Chilli, step 1' }).fill('Fry the onions.');
    await page.getByRole('textbox', { name: 'Chilli, step 1' }).press('Enter');
    await expect(page.getByRole('textbox', { name: 'Chilli, step 2' })).toBeFocused();
    await page.keyboard.type('Add the beans and simmer.');

    // A timer on the second step, typed in the sheet
    await page.getByRole('button', { name: 'Add a timer to Chilli, step 2' }).click();
    const sheet = page.getByRole('dialog', { name: 'Timer for Chilli, step 2' });
    await sheet.getByRole('textbox', { name: 'How long' }).fill('20 min');
    await sheet.getByRole('button', { name: 'Set timer' }).click();
    await expect(page.getByRole('button', { name: 'Timer for Chilli, step 2: 20 min. Change it' })).toBeVisible();

    // A second section, with the beans in it
    await page.getByRole('button', { name: 'Add section' }).click();
    await expect(page.getByRole('textbox', { name: 'Section 2', exact: true })).toBeFocused();
    await page.keyboard.type('To serve');
    await page.getByRole('textbox', { name: 'To serve, step 1' }).fill('Ladle into bowls.');
    await page.getByRole('button', { name: 'Options for line 2' }).click();
    await page.getByRole('group', { name: 'Section' }).getByRole('menuitemradio', { name: 'To serve' }).click();
    await expect(page.getByRole('list', { name: 'Ingredient lines: To serve' }).getByRole('combobox')).toHaveValue('kidney beans');

    await page.getByRole('button', { name: 'Save' }).click();

    // The page: lines grouped, the method in its sections
    await expect(page.getByRole('heading', { level: 1, name: 'Chilli Bowl' })).toBeVisible();
    const ingredients = page.getByRole('region', { name: 'Ingredients' });
    await expect(ingredients.getByRole('heading', { level: 3 })).toHaveText(['To serve']);
    await expect(ingredients.getByRole('listitem')).toHaveText(['2onion', '1 cankidney beans']);
    const method = page.getByRole('region', { name: 'Method' });
    await expect(method.getByRole('heading', { level: 3 })).toHaveText(['Chilli', 'To serve']);

    // One tap starts the step's timer: its chip is named after the step, and the step shows the time left
    await method.getByRole('button', { name: 'Start 20 min timer' }).click();
    const timers = page.getByRole('region', { name: 'Timers' });
    await expect(timers).toContainText('Chilli, step 2 20:00');
    await expect(method).toContainText('20:00 left');
    await page.clock.runFor(5 * 60_000);
    await expect(method).toContainText('15:00 left');
    await expect(timers).toContainText('Chilli, step 2 15:00');

    // And it all comes back in the editor as it was saved
    // The ⋮ menu, since a phone-width page hides the Edit link
    await page.getByRole('button', { name: 'More options for Chilli Bowl' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('textbox', { name: 'Chilli, step 2' })).toHaveValue('Add the beans and simmer.');
    await expect(page.getByRole('button', { name: 'Timer for Chilli, step 2: 20 min. Change it' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Ingredient lines: To serve' }).getByRole('combobox')).toHaveValue('kidney beans');
});
