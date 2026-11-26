/**
 * @module web/e2e/editing
 * Editing recipes and ingredients (Step 12). Each test starts from the base
 * seed: Beef Chili and its 12 ingredients.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectJustUnder } from './helpers';

/** Open a recipe's ⋮ menu (on its page or its list row) and choose an item. */
async function fromMenu(page: Page, recipe: string, item: string) {
    await page.getByRole('button', { name: `More options for ${recipe}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
}

async function openBeefChili(page: Page) {
    await page.goto('/');
    await page.getByRole('link', { name: /Beef Chili/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
}

test('create a recipe with lines and a new ingredient, edit it, and delete it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'New recipe' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();

    await page.getByLabel('Name').fill('Garlic Bread');
    await page.getByLabel('Serves').fill('4');
    await page.getByLabel('Amount, line 1').fill('2 cloves');
    const ingredientBox = page.getByRole('combobox', { name: 'Ingredient, line 1' });
    await ingredientBox.fill('garl');
    await expectJustUnder(page.getByRole('listbox', { name: 'Matching ingredients' }), ingredientBox);
    await page.getByRole('option', { name: 'garlic' }).click();

    await page.getByRole('button', { name: 'Add ingredient' }).click();
    await expect(page.getByLabel('Amount, line 2')).toBeFocused();
    await page.getByLabel('Amount, line 2').fill('100g');
    await page.getByRole('combobox', { name: 'Ingredient, line 2' }).fill('Salted butter');
    await page.getByRole('option', { name: 'Create ingredient “salted butter”' }).click();
    await expect(page.getByRole('combobox', { name: 'Ingredient, line 2' })).toHaveValue('salted butter');

    // A box per step: Enter starts the next one
    await page.getByRole('textbox', { name: 'Step 1' }).fill('Mix the butter and garlic.');
    await page.getByRole('textbox', { name: 'Step 1' }).press('Enter');
    await page.keyboard.type('Spread on the bread.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bake for 10 minutes.');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Garlic Bread' })).toBeVisible();
    const lines = page.getByRole('region', { name: 'Ingredients' }).getByRole('listitem');
    await expect(lines).toHaveText(['2 clovesgarlic', '100 gsalted butter']);
    await expect(page.getByRole('region', { name: 'Method' }).getByRole('listitem')).toHaveCount(3);

    // Edit it: a range, a note, and more servings
    await fromMenu(page, 'Garlic Bread', 'Edit');
    await expect(page.getByLabel('Name')).toHaveValue('Garlic Bread');
    await page.getByLabel('Serves').fill('6');
    await page.getByLabel('Amount, line 1').fill('2-3 cloves');
    await page.getByRole('button', { name: 'Options for line 1' }).click();
    await page.getByRole('menuitem', { name: 'Add note' }).click();
    await page.getByLabel('Note, line 1').fill('crushed');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Serves 6')).toBeVisible();
    await expect(lines.first()).toHaveText('2–3 clovesgarlic, crushed');

    // Delete it
    await fromMenu(page, 'Garlic Bread', 'Delete recipe…');
    const dialog = page.getByRole('alertdialog', { name: 'Delete Garlic Bread?' });
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Garlic Bread/ })).toHaveCount(0);
});

test('saving over a change made on another device gets the 412 prompt, and Reload shows it', async ({
    page,
    browser,
    baseURL,
}) => {
    const laptop = await browser.newContext({ baseURL });
    try {
        await openBeefChili(page);
        const id = new URL(page.url()).pathname.split('/').pop();
        await fromMenu(page, 'Beef Chili', 'Edit');
        await expect(page.getByLabel('Serves')).toHaveValue('2');

        // Meanwhile, on the laptop
        expect((await laptop.request.patch(`/api/recipes/${id}`, { data: { servings: 5 } })).ok()).toBe(true);

        await page.getByLabel('Description').fill('Changed on the phone');
        await page.getByRole('button', { name: 'Save' }).click();

        const dialog = page.getByRole('alertdialog', { name: 'This recipe changed on another device' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Reload recipe' }).click();

        await expect(page.getByLabel('Serves')).toHaveValue('5');
        await expect(page.getByLabel('Description')).toHaveValue('Chilli con Carne using Beef mince and bacon lardons');
    } finally {
        await laptop.close();
    }
});

test('leaving the editor with unsaved changes asks first', async ({ page }) => {
    await openBeefChili(page);
    await fromMenu(page, 'Beef Chili', 'Edit');
    await page.getByLabel('Name').fill('Beef Chilli');

    await page.getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('Name')).toHaveValue('Beef Chilli');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeVisible();
});

test('rename an ingredient, and the recipe shows the new name', async ({ page }) => {
    await page.goto('/options/ingredients');
    await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('lardons');
    await page.getByRole('button', { name: 'More options for lardons' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Rename “lardons”').fill('Bacon lardons');
    await page.getByLabel('Rename “lardons”').press('Enter');

    await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('');
    await expect(page.getByRole('list', { name: 'Ingredients' }).getByText('bacon lardons')).toBeVisible();

    // An ingredient a recipe uses can't be deleted
    await page.getByRole('button', { name: 'More options for onion' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByRole('alertdialog', { name: 'Delete “onion”?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alert')).toHaveText("Can't delete “onion”: a recipe still uses it.Dismiss");

    await openBeefChili(page);
    await expect(page.getByRole('region', { name: 'Ingredients' }).getByText('bacon lardons')).toBeVisible();
});
