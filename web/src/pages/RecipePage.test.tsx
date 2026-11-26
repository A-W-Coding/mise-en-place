import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { BEEF_CHILI_ID, beefChili, equipmentOn, item, section, tag, tagsOn } from '../test/fixtures';
import { json, mockApi, page, renderApp, sent, unreachable } from '../test/renderApp';

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

    test('a method in several sections shows each under its name, numbered from 1 in each', async () => {
        const recipe = {
            ...beefChili,
            sections: [
                section(BEEF_CHILI_ID, 0, 'Sauce', ['Fry the onions.', 'Simmer.']),
                section(BEEF_CHILI_ID, 1, 'Grouping only', []),
                section(BEEF_CHILI_ID, 2, 'To serve', ['Ladle out.']),
            ],
        };
        mockApi([['GET', RECIPE_PATH, json(recipe)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const method = await screen.findByRole('region', { name: 'Method' });
        // A section with no steps only groups lines, so it has no place in the method
        expect(within(method).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
            'Sauce',
            'To serve',
        ]);
        expect(within(method).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            '1Fry the onions.',
            '2Simmer.',
            '1Ladle out.',
        ]);
    });

    test('ingredients in sections show under their names, lines in no section first with no heading (3b)', async () => {
        const recipe = {
            ...beefChili,
            sections: [section(BEEF_CHILI_ID, 0, 'Chilli', ['Fry.']), section(BEEF_CHILI_ID, 1, 'To serve', [])],
        };
        // Saved in an order that mixes the groups: the page still groups them
        recipe.recipeIngredients = beefChili.recipeIngredients.map((line, index) => ({
            ...line,
            sectionId: index === 0 || index === 5 ? recipe.sections[0]!.id : index === 6 ? recipe.sections[1]!.id : null,
        }));
        mockApi([['GET', RECIPE_PATH, json(recipe)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const ingredients = await screen.findByRole('region', { name: 'Ingredients' });
        expect(within(ingredients).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
            'Chilli',
            'To serve',
        ]);
        expect(within(ingredients).getAllByRole('list').map((list) => within(list).getAllByRole('listitem').length)).toEqual([
            4, 2, 1,
        ]);
        expect(within(ingredients).getAllByRole('listitem')[4]?.textContent).toBe('1onion, diced');
    });

    test('shows every tag under the name, each opening the list filtered by it, and the equipment (3b)', async () => {
        const weeknight = tag('weeknight', '#1f4e79');
        const recipe = {
            ...beefChili,
            tags: tagsOn(BEEF_CHILI_ID, [tag('beef', '#f6c7bd'), tag('mexican'), tag('spicy'), weeknight]),
            equipment: equipmentOn(BEEF_CHILI_ID, [[item('large pan')], [item('garlic press'), 1, true], [item('ramekin'), 4]]),
        };
        mockApi([['GET', RECIPE_PATH, json(recipe)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const tags = await screen.findByRole('list', { name: 'Tags' });
        expect(within(tags).getAllByRole('link').map((link) => link.textContent)).toEqual(['Beef', 'Mexican', 'Spicy', 'Weeknight']);
        expect(within(tags).getByRole('link', { name: 'Weeknight' })).toHaveAttribute('href', `/?tag=${weeknight.id}`);
        // White text on a dark tag, so it reads
        expect(within(tags).getByRole('link', { name: 'Weeknight' })).toHaveStyle({ color: '#ffffff' });

        const equipment = screen.getByRole('region', { name: 'Equipment' });
        expect(within(equipment).getAllByRole('listitem').map((line) => line.textContent)).toEqual([
            '1large pan',
            '1garlic pressoptional',
            '4ramekin',
        ]);
        // The ingredients keep their own list
        expect(within(screen.getByRole('region', { name: 'Ingredients' })).getAllByRole('listitem')).toHaveLength(7);
    });

    test('a recipe with no tags or equipment shows neither', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await screen.findByRole('heading', { level: 1, name: 'Beef Chili' });
        expect(screen.queryByRole('list', { name: 'Tags' })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Equipment' })).not.toBeInTheDocument();
    });

    test('one section called "Method" needs no heading of its own', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const method = await screen.findByRole('region', { name: 'Method' });
        expect(within(method).queryAllByRole('heading', { level: 3 })).toEqual([]);
    });

    test('a recipe with no lines or method says so', async () => {
        mockApi([['GET', RECIPE_PATH, json({ ...beefChili, sections: [], recipeIngredients: [] })]]);
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
    test('Delete asks first, sends the ETag of the version on screen, and goes to the list', async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"111"' } })],
            ['DELETE', RECIPE_PATH, json({ message: 'Recipe deleted successfully.' })],
            ['GET', '/api/recipes', page([])],
        ]);
        const { user, router } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('button', { name: 'More options for Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete recipe…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete Beef Chili?' });
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

        expect(await screen.findByText('No recipes yet')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/');
        expect(sent(fetchMock, 'DELETE')[0]?.headers['If-Match']).toBe('"111"');
    });

    test('a recipe changed elsewhere since it loaded is not deleted unseen', async () => {
        mockApi([
            ['GET', RECIPE_PATH, json(beefChili, { headers: { ETag: '"111"' } })],
            ['DELETE', RECIPE_PATH, json({ error: 'The recipe has changed since it was loaded.' }, { status: 412 })],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('button', { name: 'More options for Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete recipe…' }));
        const dialog = screen.getByRole('alertdialog');
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            'This recipe changed on another device since it was loaded. Check the latest version first.',
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
    });
});
