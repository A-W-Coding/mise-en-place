/**
 * @module web/e2e/tags
 * Tags and equipment (3b, Step 23): tag a recipe and filter the list by it,
 * add equipment, and rename and recolour a tag in Options. Each test starts
 * from the base seed: Beef Chili, with no tags or equipment.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectJustUnder } from './helpers';

/** Open Beef Chili's editor through its ⋮ menu, since a phone-width page hides the Edit link. */
async function editBeefChili(page: Page) {
    await page.goto('/');
    await page.getByRole('link', { name: /Beef Chili/ }).click();
    await page.getByRole('button', { name: 'More options for Beef Chili' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByLabel('Name')).toHaveValue('Beef Chili');
}

test('tag a recipe with a new tag and its colour, then filter the list by it', async ({ page, request }) => {
    // Another recipe, so the filter has something to leave out
    expect((await request.post('/api/recipes', { data: { name: 'Toast' } })).status()).toBe(201);
    await editBeefChili(page);

    const tagBox = page.getByRole('combobox', { name: 'Add a tag' });
    await tagBox.fill('Weeknight');
    // Just under the box, where the phone shows it (Step 26)
    await expectJustUnder(page.getByRole('listbox', { name: 'Matching tags' }), tagBox);
    await page.getByRole('option', { name: 'Create tag “weeknight”' }).click();
    const panel = page.getByRole('region', { name: 'Colour for the new tag Weeknight' });
    await panel.getByRole('radio', { name: 'Sky' }).click();
    await panel.getByRole('button', { name: 'Add tag' }).click();
    await expect(page.getByRole('list', { name: 'Tags' }).getByText('Weeknight')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();

    // On the recipe page, in its colour; it opens the list filtered by it
    const pill = page.getByRole('list', { name: 'Tags' }).getByRole('link', { name: 'Weeknight' });
    await expect(pill).toHaveCSS('background-color', 'rgb(200, 221, 244)');
    await pill.click();

    await expect(page.getByText(/^1 recipe tagged Weeknight/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Beef Chili/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Toast/ })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: 'Weeknight' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );

    // Clear shows every recipe again
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('link', { name: /Toast/ })).toBeVisible();
});

test('add equipment: a new item, how many, and optional', async ({ page }) => {
    await editBeefChili(page);

    await page.getByRole('button', { name: 'Add equipment' }).click();
    const itemBox = page.getByRole('combobox', { name: 'Item, equipment line 1' });
    await itemBox.fill('Dutch oven');
    await expectJustUnder(page.getByRole('listbox', { name: 'Matching equipment' }), itemBox);
    await page.getByRole('option', { name: 'Create item “dutch oven”' }).click();
    await expect(page.getByRole('combobox', { name: 'Item, equipment line 1' })).toHaveValue('dutch oven');
    await page.getByRole('group', { name: 'How many, equipment line 1' }).getByRole('button', { name: 'One more' }).click();
    await page.getByRole('checkbox', { name: 'Optional, equipment line 1' }).check();
    await page.getByRole('button', { name: 'Save' }).click();

    const equipment = page.getByRole('region', { name: 'Equipment' });
    await expect(equipment.getByRole('listitem')).toHaveText(['2dutch ovenoptional']);
});

test('rename and recolour a tag in Options, and the recipe shows it', async ({ page, request }) => {
    const created = await request.post('/api/tags', { data: { name: 'weeknight', color: '#1f4e79' } });
    const tagId = ((await created.json()) as { id: string }).id;
    const recipes = (await (await request.get('/api/recipes')).json()) as { id: string; name: string }[];
    const chili = recipes.find((recipe) => recipe.name === 'Beef Chili')!;
    expect((await request.patch(`/api/recipes/${chili.id}`, { data: { tagIds: [tagId] } })).status()).toBe(200);

    await page.goto('/options');
    await page.getByRole('link', { name: /^Tags/ }).click();
    await expect(page.getByRole('list', { name: 'Tags' })).toContainText('Weeknight1 recipe');

    await page.getByRole('button', { name: 'More options for Weeknight' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByRole('textbox', { name: 'Rename Weeknight' }).fill('Midweek');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('list', { name: 'Tags' })).toContainText('Midweek1 recipe');

    await page.getByRole('button', { name: 'More options for Midweek' }).click();
    await page.getByRole('menuitem', { name: 'Change colour' }).click();
    const form = page.getByRole('form', { name: 'Colour for Midweek' });
    await form.getByRole('radio', { name: 'Mint' }).click();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toHaveCount(0);

    await page.goto(`/recipes/${chili.id}`);
    const pill = page.getByRole('list', { name: 'Tags' }).getByRole('link', { name: 'Midweek' });
    await expect(pill).toHaveCSS('background-color', 'rgb(198, 231, 223)');
    // Dark text on a light colour
    await expect(pill).toHaveCSS('color', 'rgb(0, 0, 0)');
});
