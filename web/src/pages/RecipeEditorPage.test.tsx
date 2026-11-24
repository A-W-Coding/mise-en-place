import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Ingredient } from '../api/types';
import { BEEF_CHILI_ID, beefChili, beefChiliSummary, section } from '../test/fixtures';
import { json, mockApi, page, renderApp, sent } from '../test/renderApp';

const RECIPE_PATH = `/api/recipes/${BEEF_CHILI_ID}`;
const NEW_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function ingredient(name: string, id = `id-${name}`): Ingredient {
    return { id, name, createdAt: '2026-11-23T10:00:00.000Z', updatedAt: '2026-11-23T10:00:00.000Z' };
}

const lardons = ingredient('lardons', '33333333-3333-4333-8333-333333333333');

/** The ingredient search the picker makes, answering from a fixed list. */
function ingredientSearch(all: Ingredient[]) {
    return (url: URL) => {
        const search = url.searchParams.get('search') ?? '';
        return page(all.filter((item) => item.name.includes(search)));
    };
}

describe('RecipeEditorPage: a new recipe', () => {
    test('picks ingredients as you type, saves with the id made on the device, and opens the new recipe', async () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(NEW_ID);
        const fetchMock = mockApi([
            ['GET', '/api/ingredients', ingredientSearch([lardons])],
            ['POST', '/api/recipes', json({ ...beefChili, id: NEW_ID, name: 'Carbonara' }, { status: 201 })],
            ['GET', `/api/recipes/${NEW_ID}`, json({ ...beefChili, id: NEW_ID, name: 'Carbonara' })],
        ]);
        const { user, router } = renderApp('/recipes/new');

        expect(await screen.findByRole('heading', { level: 1, name: 'New recipe' })).toBeInTheDocument();
        await user.type(screen.getByLabelText('Name'), 'Carbonara');
        await user.clear(screen.getByLabelText('Serves'));
        await user.type(screen.getByLabelText('Serves'), '2');
        await user.type(screen.getByLabelText('Amount, line 1'), '100g');
        await user.type(screen.getByRole('combobox', { name: 'Ingredient, line 1' }), 'lard');
        await user.click(await screen.findByRole('option', { name: 'lardons' }));
        // Enter starts the next step, so a method is typed straight through
        await user.type(screen.getByRole('textbox', { name: 'Step 1' }), 'Fry.{Enter}Toss.');
        expect(screen.getByRole('textbox', { name: 'Step 2' })).toHaveValue('Toss.');

        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Carbonara' })).toBeInTheDocument();
        expect(router.state.location.pathname).toBe(`/recipes/${NEW_ID}`);
        expect(sent(fetchMock, 'POST')[0]?.body).toEqual({
            id: NEW_ID,
            name: 'Carbonara',
            description: null,
            servings: 2,
            prepTime: null,
            cookTime: null,
            sections: [
                {
                    name: 'Method',
                    steps: [
                        { text: 'Fry.', timerSeconds: null },
                        { text: 'Toss.', timerSeconds: null },
                    ],
                },
            ],
            ingredients: [{ ingredientId: lardons.id, quantity: 100, quantityMax: null, unit: 'g', note: null, sectionIndex: null }],
        });
    });

    test('creates a missing ingredient on the spot', async () => {
        const chipotle = ingredient('chipotle', '44444444-4444-4444-8444-444444444444');
        const fetchMock = mockApi([
            ['GET', '/api/ingredients', page([])],
            ['POST', '/api/ingredients', json(chipotle, { status: 201 })],
        ]);
        const { user } = renderApp('/recipes/new');

        const box = await screen.findByRole('combobox', { name: 'Ingredient, line 1' });
        await user.type(box, 'Chipotle');
        await user.click(await screen.findByRole('option', { name: 'Create ingredient “chipotle”' }));

        await waitFor(() => expect(box).toHaveValue('chipotle'));
        expect(sent(fetchMock, 'POST')).toEqual([expect.objectContaining({ path: '/api/ingredients', body: { name: 'chipotle' } })]);
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    test('picks with the keyboard: arrows, then Enter', async () => {
        mockApi([['GET', '/api/ingredients', ingredientSearch([ingredient('garlic'), ingredient('ginger')])]]);
        const { user } = renderApp('/recipes/new');

        const box = await screen.findByRole('combobox', { name: 'Ingredient, line 1' });
        await user.type(box, 'g');
        await screen.findByRole('option', { name: 'ginger' });
        await user.keyboard('{ArrowDown}{ArrowDown}');
        expect(box).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'ginger' }).id);
        await user.keyboard('{Enter}');

        expect(box).toHaveValue('ginger');
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    test('shows problems next to their boxes, sends nothing, and focuses the first', async () => {
        const fetchMock = mockApi([['GET', '/api/ingredients', page([])]]);
        const { user } = renderApp('/recipes/new');

        await user.type(await screen.findByLabelText('Amount, line 1'), '1,5 kg');
        await user.tab();
        expect(await screen.findByText("Couldn't read that amount. Try 100 g, 1½ tbsp or 2-3.")).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.getByRole('alert')).toHaveTextContent('3 things need a look before saving.');
        expect(screen.getByText('Give the recipe a name.')).toBeInTheDocument();
        expect(screen.getByText('Choose an ingredient.')).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toHaveFocus();
        expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
        expect(sent(fetchMock, 'POST')).toEqual([]);
    });
});

describe('RecipeEditorPage: editing', () => {
    test('a recipe in several sections opens with a card for each and a box per step, and saves them back (3b)', async () => {
        const recipe = {
            ...beefChili,
            sections: [section(BEEF_CHILI_ID, 0, 'Sauce', ['Fry.', ['Simmer.', 600]]), section(BEEF_CHILI_ID, 1, 'To serve', ['Ladle.'])],
        };
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(recipe, { headers: { ETag: '"1"' } })],
            ['PATCH', RECIPE_PATH, json(recipe, { headers: { ETag: '"2"' } })],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        expect(await screen.findByRole('textbox', { name: 'Section 2' })).toHaveValue('To serve');
        expect(screen.getByRole('textbox', { name: 'Sauce, step 2' })).toHaveValue('Simmer.');
        expect(screen.getByRole('button', { name: 'Timer for Sauce, step 2: 10 min. Change it' })).toHaveTextContent('10 min');
        expect(screen.getByRole('button', { name: 'Add a timer to Sauce, step 1' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Add step to To serve' }));
        expect(screen.getByRole('textbox', { name: 'To serve, step 2' })).toHaveFocus();
        await user.keyboard('Garnish.');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(sent(fetchMock, 'PATCH')).toHaveLength(1));
        expect(sent(fetchMock, 'PATCH')[0]?.body).toMatchObject({
            sections: [
                {
                    name: 'Sauce',
                    steps: [
                        { text: 'Fry.', timerSeconds: null },
                        { text: 'Simmer.', timerSeconds: 600 },
                    ],
                },
                {
                    name: 'To serve',
                    steps: [
                        { text: 'Ladle.', timerSeconds: null },
                        { text: 'Garnish.', timerSeconds: null },
                    ],
                },
            ],
        });
    });

    test("a step's Timer button sets its timer in a sheet: typed, from a preset, or removed (3b)", async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"1"' } })],
            ['PATCH', RECIPE_PATH, json(beefChili, { headers: { ETag: '"2"' } })],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await user.click(await screen.findByRole('button', { name: 'Add a timer to step 3' }));
        let sheet = screen.getByRole('dialog', { name: 'Timer for step 3' });
        expect(sheet).toHaveTextContent('Simmer for at least 20 minutes.');
        const length = within(sheet).getByRole('textbox', { name: 'How long' });
        expect(length).toHaveFocus();
        // Something it can't read is refused in the sheet
        await user.type(length, '1:30');
        await user.click(within(sheet).getByRole('button', { name: 'Set timer' }));
        expect(within(sheet).getByText("Couldn't read that. Try 90 s, 15 min or 1 h 30 min.")).toBeInTheDocument();
        expect(length).toHaveAttribute('aria-invalid', 'true');
        await user.clear(length);
        await user.type(length, '1h 30');
        await user.click(within(sheet).getByRole('button', { name: 'Set timer' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Timer for step 3: 1 h 30 min. Change it' })).toBeInTheDocument();

        // Changed with a preset; the sheet opens with the length it has
        await user.click(screen.getByRole('button', { name: 'Timer for step 3: 1 h 30 min. Change it' }));
        sheet = screen.getByRole('dialog', { name: 'Timer for step 3' });
        expect(within(sheet).getByRole('textbox', { name: 'How long' })).toHaveValue('1 h 30 min');
        await user.click(within(sheet).getByRole('button', { name: '20 min' }));
        expect(within(sheet).getByRole('button', { name: '20 min' })).toHaveAttribute('aria-pressed', 'true');
        await user.click(within(sheet).getByRole('button', { name: 'Set timer' }));

        // Removed from another step
        await user.click(screen.getByRole('button', { name: 'Add a timer to step 1' }));
        sheet = screen.getByRole('dialog', { name: 'Timer for step 1' });
        expect(within(sheet).queryByRole('button', { name: 'Remove timer' })).not.toBeInTheDocument();
        await user.click(within(sheet).getByRole('button', { name: '5 min' }));
        await user.click(within(sheet).getByRole('button', { name: 'Set timer' }));
        await user.click(screen.getByRole('button', { name: 'Timer for step 1: 5 min. Change it' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove timer' }));
        expect(screen.getByRole('button', { name: 'Add a timer to step 1' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(sent(fetchMock, 'PATCH')).toHaveLength(1));
        expect(sent(fetchMock, 'PATCH')[0]?.body).toMatchObject({
            sections: [
                {
                    name: 'Method',
                    steps: [
                        { text: 'Heat some oil and cook the onions.', timerSeconds: null },
                        { text: 'Add the garlic.', timerSeconds: null },
                        { text: 'Simmer for at least 20 minutes.', timerSeconds: 1200 },
                    ],
                },
            ],
        });
    });

    test("Add section, then a line's ⋮ menu puts it in that section, shown under its name (3b)", async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"1"' } })],
            ['PATCH', RECIPE_PATH, json(beefChili, { headers: { ETag: '"2"' } })],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        // With only "Method", lines aren't offered a section
        await user.click(await screen.findByRole('button', { name: 'Options for line 1' }));
        expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
        await user.keyboard('{Escape}');

        await user.click(screen.getByRole('button', { name: 'Add section' }));
        expect(screen.getByRole('textbox', { name: 'Section 2' })).toHaveFocus();
        await user.keyboard('To serve');

        await user.click(screen.getByRole('button', { name: 'Options for line 1' }));
        const choice = screen.getByRole('group', { name: 'Section' });
        expect(within(choice).getByRole('menuitemradio', { name: 'No section' })).toHaveAttribute('aria-checked', 'true');
        await user.click(within(choice).getByRole('menuitemradio', { name: 'To serve' }));

        // Lines in no section first, then the new section's, under its name
        expect(screen.getByRole('heading', { name: 'No section' })).toBeInTheDocument();
        const serving = screen.getByRole('list', { name: 'Ingredient lines: To serve' });
        expect(within(serving).getByRole('combobox', { name: 'Ingredient, line 7' })).toHaveValue('onion');
        // The first line of a group can't move up into the group above
        await user.click(screen.getByRole('button', { name: 'Options for line 7' }));
        expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
        await user.keyboard('{Escape}');

        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(sent(fetchMock, 'PATCH')).toHaveLength(1));
        const body = sent(fetchMock, 'PATCH')[0]?.body as { sections: unknown[]; ingredients: { sectionIndex: number | null }[] };
        // A section with no steps is kept, to hold its line
        expect(body.sections).toEqual([expect.objectContaining({ name: 'Method' }), { name: 'To serve', steps: [] }]);
        expect(body.ingredients.map((line) => line.sectionIndex)).toEqual([null, null, null, null, null, null, 1]);
    });

    test('removing a section with steps or lines asks first, and its lines stay, in no section (3b)', async () => {
        const recipe = {
            ...beefChili,
            sections: [section(BEEF_CHILI_ID, 0, 'Chilli', ['Fry.']), section(BEEF_CHILI_ID, 1, 'To serve', ['Ladle.'])],
        };
        recipe.recipeIngredients = beefChili.recipeIngredients.map((line, index) => ({
            ...line,
            sectionId: index === 0 ? recipe.sections[1]!.id : null,
        }));
        mockApi([['GET', RECIPE_PATH, json(recipe)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await user.click(await screen.findByRole('button', { name: 'Options for section To serve' }));
        await user.click(screen.getByRole('menuitem', { name: 'Remove section…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Remove To serve?' });
        expect(dialog).toHaveTextContent('Its 1 step goes with it. Its 1 ingredient line stays, in no section.');
        await user.click(within(dialog).getByRole('button', { name: 'Remove section' }));

        expect(screen.queryByRole('textbox', { name: 'Section 2' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'No section' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add section' })).toHaveFocus();

        // An empty section goes at once
        await user.click(screen.getByRole('button', { name: 'Add section' }));
        await user.click(screen.getByRole('button', { name: 'Options for section Section 2' }));
        await user.click(screen.getByRole('menuitem', { name: 'Remove section…' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Section 2' })).not.toBeInTheDocument();
    });

    test("pasting several lines into a step makes a step of each; the API's message on a step lands on its box (3b)", async () => {
        mockApi([
            ['GET', RECIPE_PATH, json(beefChili)],
            [
                'PATCH',
                RECIPE_PATH,
                json({ error: 'Validation failed.', fields: { 'sections.0.steps.1.text': 'Must not be empty.' } }, { status: 400 }),
            ],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        const first = await screen.findByRole('textbox', { name: 'Step 1' });
        await user.clear(first);
        await user.click(first);
        await user.paste('1. Heat the oil.\n2. Fry the onions.');
        expect(first).toHaveValue('Heat the oil.');
        expect(screen.getByRole('textbox', { name: 'Step 2' })).toHaveValue('Fry the onions.');
        expect(screen.getByRole('textbox', { name: 'Step 3' })).toHaveValue('Add the garlic.');

        // The Method closed, so the API's message has to open it
        await user.click(screen.getByRole('button', { name: 'Method' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Must not be empty.')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Step 2' })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('textbox', { name: 'Step 2' })).toHaveFocus();
    });

    test('loads the recipe, and saves it with If-Match and the lines as they were', async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"111"' } })],
            ['PATCH', RECIPE_PATH, json({ ...beefChili, servings: 3 }, { headers: { ETag: '"222"' } })],
        ]);
        const { user, router } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        expect(await screen.findByLabelText('Name')).toHaveValue('Beef Chili');
        expect(screen.getByLabelText('Amount, line 3')).toHaveValue('1 clove');
        expect(screen.getByRole('combobox', { name: 'Ingredient, line 3' })).toHaveValue('garlic');
        expect(screen.getByLabelText('Note, line 3')).toHaveValue('chopped');
        expect(screen.queryByLabelText('Note, line 4')).not.toBeInTheDocument();

        await user.clear(screen.getByLabelText('Serves'));
        await user.type(screen.getByLabelText('Serves'), '3');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${BEEF_CHILI_ID}`));
        const [patch] = sent(fetchMock, 'PATCH');
        expect(patch?.headers['If-Match']).toBe('"111"');
        expect(patch?.body).toMatchObject({
            servings: 3,
            ingredients: beefChili.recipeIngredients.map((line) => ({
                ingredientId: line.ingredientId,
                quantity: line.quantity,
                quantityMax: line.quantityMax,
                unit: line.unit,
                note: line.note,
            })),
        });
    });

    test("puts the API's field errors next to the right line", async () => {
        mockApi([
            ['GET', RECIPE_PATH, json(beefChili)],
            [
                'PATCH',
                RECIPE_PATH,
                json(
                    { error: 'Validation failed.', fields: { 'ingredients.1.quantity': 'Must be greater than 0.' } },
                    { status: 400 },
                ),
            ],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await user.click(await screen.findByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Must be greater than 0.')).toBeInTheDocument();
        expect(screen.getByLabelText('Amount, line 2')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Amount, line 2')).toHaveFocus();
    });

    test('a recipe changed elsewhere gets the 412 prompt, and Reload recipe starts again from the latest', async () => {
        let current = beefChili;
        mockApi([
            ['GET', RECIPE_PATH, () => json(current, { headers: { ETag: `"${current.name.length}"` } })],
            ['PATCH', RECIPE_PATH, json({ error: 'The recipe has changed since it was loaded.' }, { status: 412 })],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await user.type(await screen.findByLabelText('Description'), ' (mine)');
        current = { ...beefChili, name: 'Beef Chili, spicier' };
        await user.click(screen.getByRole('button', { name: 'Save' }));

        const dialog = await screen.findByRole('alertdialog', { name: 'This recipe changed on another device' });
        await user.click(within(dialog).getByRole('button', { name: 'Reload recipe' }));

        await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Beef Chili, spicier'));
        expect(screen.getByLabelText('Description')).toHaveValue(beefChili.description);
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    test("each line's ⋮ menu moves it, adds a note, and removes it", async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);
        const ingredientOf = (n: number) => screen.getByRole('combobox', { name: `Ingredient, line ${n}` });

        await user.click(await screen.findByRole('button', { name: 'Options for line 1' }));
        await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
        expect(ingredientOf(1)).toHaveValue('red pepper');
        expect(ingredientOf(2)).toHaveValue('onion');

        await user.click(screen.getByRole('button', { name: 'Options for line 4' }));
        await user.click(screen.getByRole('menuitem', { name: 'Add note' }));
        expect(screen.getByLabelText('Note, line 4')).toHaveFocus();

        await user.click(screen.getByRole('button', { name: 'Options for line 1' }));
        expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
        await user.click(screen.getByRole('menuitem', { name: 'Remove line' }));
        expect(ingredientOf(1)).toHaveValue('onion');
        expect(screen.getByRole('button', { name: /Ingredients \(6\)/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add ingredient' })).toHaveFocus();
    });

    test('the Ingredients and Method sections collapse', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        const toggle = await screen.findByRole('button', { name: /Ingredients \(7\)/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        // Hidden, not removed, so nothing typed in a closed section is lost
        expect(screen.getByLabelText('Amount, line 1')).not.toBeVisible();

        await user.click(toggle);
        expect(screen.getByLabelText('Amount, line 1')).toBeVisible();
    });

    test('leaving with unsaved changes asks first', async () => {
        mockApi([
            ['GET', RECIPE_PATH, json(beefChili)],
            ['GET', '/api/recipes', page([beefChiliSummary])],
        ]);
        const { user, router } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await user.type(await screen.findByLabelText('Name'), '!');
        await user.click(screen.getByRole('link', { name: 'Mise en place' }));

        const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
        expect(dialog).toHaveTextContent('Your changes to Beef Chili! will be lost.');
        await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(router.state.location.pathname).toBe(`/recipes/${BEEF_CHILI_ID}/edit`);
        expect(screen.getByLabelText('Name')).toHaveValue('Beef Chili!');

        await user.click(screen.getByRole('link', { name: 'Mise en place' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    });

    test('leaving without changes just goes', async () => {
        mockApi([
            ['GET', RECIPE_PATH, json(beefChili)],
            ['GET', '/api/recipes', page([beefChiliSummary])],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await screen.findByLabelText('Name');
        await user.click(screen.getByRole('link', { name: 'Mise en place' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    });

    test('Delete recipe asks first, then deletes with If-Match and goes to the list', async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"111"' } })],
            ['DELETE', RECIPE_PATH, json({ message: 'Recipe deleted successfully.' })],
            ['GET', '/api/recipes', page([])],
        ]);
        const { user, router } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        await user.click(await screen.findByRole('button', { name: 'Delete recipe' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete Beef Chili?' });
        expect(dialog).toHaveTextContent("This can't be undone. Its ingredients stay in the shared list.");
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

        expect(await screen.findByText('No recipes yet')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/');
        expect(sent(fetchMock, 'DELETE')[0]?.headers['If-Match']).toBe('"111"');
    });
});
