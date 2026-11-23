import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { BEEF_CHILI_ID, beefChili } from '../test/fixtures';
import { json, mockApi, renderApp, unreachable } from '../test/renderApp';

const RECIPE_PATH = `/api/recipes/${BEEF_CHILI_ID}`;
const notFound = () => json({ error: 'Recipe not found.' }, { status: 404 });

describe('RecipePage', () => {
    test('shows the summary, amounts as a recipe writes them, and the method as numbered steps', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"1"' } })]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
        expect(screen.getByText('Chilli con Carne using Beef mince and bacon lardons')).toBeInTheDocument();
        expect(screen.getByText('Serves 2 · Prep 20 min · Cook 2 h')).toBeInTheDocument();
        expect(document.title).toBe('Beef Chili · Mise en place');

        const ingredients = within(screen.getByRole('region', { name: 'Ingredients' })).getAllByRole('listitem');
        expect(ingredients.map((item) => item.textContent)).toEqual([
            '1onion, diced',
            '½red pepper, diced',
            '1 clovegarlic, chopped',
            '1–2 tspsmoked paprika',
            'cayenne pepper, to taste',
            '500 gbeef mince',
            '2 canssweetcorn, drained',
        ]);

        const steps = within(screen.getByRole('region', { name: 'Method' })).getAllByRole('listitem');
        expect(steps.map((item) => item.textContent)).toEqual([
            '1Heat some oil and cook the onions.',
            '2Add the garlic.',
            '3Simmer for at least 20 minutes.',
        ]);
    });

    test('a recipe with no lines or method says so', async () => {
        mockApi([['GET', RECIPE_PATH, json({ ...beefChili, instructions: null, recipeIngredients: [] })]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByText('No ingredients yet.')).toBeInTheDocument();
        expect(screen.getByText('No method yet.')).toBeInTheDocument();
    });

    test('a recipe that no longer exists says it was deleted, not that something failed', async () => {
        mockApi([['GET', RECIPE_PATH, notFound]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByRole('heading', { level: 1, name: 'This recipe was deleted' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to recipes' })).toHaveAttribute('href', '/');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('a recipe deleted elsewhere while open says so at the next refresh', async () => {
        let exists = true;
        mockApi([['GET', RECIPE_PATH, () => (exists ? json(beefChili) : notFound())]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        await screen.findByRole('heading', { level: 1, name: 'Beef Chili' });

        exists = false;
        await user.click(screen.getByRole('button', { name: 'Refresh' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'This recipe was deleted' })).toBeInTheDocument();
        expect(screen.queryByText('Beef Chili')).not.toBeInTheDocument();
    });

    test('a refresh that fails keeps the recipe on screen, under the banner', async () => {
        let online = true;
        mockApi([['GET', RECIPE_PATH, () => (online ? json(beefChili) : unreachable())]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        await screen.findByRole('heading', { level: 1, name: 'Beef Chili' });

        online = false;
        await user.click(screen.getByRole('button', { name: 'Refresh' }));

        expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.");
        expect(screen.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
    });

    test("can't reach the server on the first load: a banner with Retry", async () => {
        let online = false;
        mockApi([['GET', RECIPE_PATH, () => (online ? json(beefChili) : unreachable())]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const alert = await screen.findByRole('alert');
        online = true;
        await user.click(within(alert).getByRole('button', { name: 'Retry' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
    });

    test('"Recipes" goes back to the list it came from, search included', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        renderApp({ pathname: `/recipes/${BEEF_CHILI_ID}`, state: { from: '/?q=chili' } });

        await screen.findByRole('heading', { level: 1, name: 'Beef Chili' });
        expect(screen.getByRole('link', { name: 'Back to Recipes' })).toHaveAttribute('href', '/?q=chili');
    });

    test('?print prints once the recipe is on screen, then drops the flag', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        const { router } = renderApp(`/recipes/${BEEF_CHILI_ID}?print`);

        await screen.findByRole('heading', { level: 1, name: 'Beef Chili' });
        await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
        expect(router.state.location.search).toBe('');
    });

    test('the ⋮ menu and Edit are on the page too', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('button', { name: 'More options for Beef Chili' }));

        expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(3);
        expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', `/recipes/${BEEF_CHILI_ID}/edit`);
    });
});
