import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { PAGE_SIZE } from '../api/queries';
import { beefChiliSummary, summary } from '../test/fixtures';
import { scrollNearEnd } from '../test/intersectionObserver';
import { json, mockApi, page, renderApp, requestedUrls, sent, unreachable } from '../test/renderApp';

const bananaBread = summary('Banana Bread', { servings: 8, prepTime: 15, cookTime: 60 });

describe('RecipeListPage', () => {
    test('lists each recipe with its summary line, linking to its page', async () => {
        mockApi([['GET', '/api/recipes', page([bananaBread, beefChiliSummary])]]);
        renderApp('/');

        const chili = await screen.findByRole('link', { name: /Beef Chili/ });
        expect(chili).toHaveAttribute('href', `/recipes/${beefChiliSummary.id}`);
        expect(chili).toHaveTextContent('Serves 2 · 20 min prep · 2 h cook');
        expect(screen.getByRole('link', { name: /Banana Bread/ })).toHaveTextContent('Serves 8 · 15 min prep · 1 h cook');
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
        expect(within(screen.getByRole('list', { name: 'Recipes' })).getAllByRole('listitem')).toHaveLength(2);
    });

    test('says so when there are no recipes yet', async () => {
        mockApi([['GET', '/api/recipes', page([])]]);
        renderApp('/');

        expect(await screen.findByText('No recipes yet')).toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: 'New recipe' })[0]).toHaveAttribute('href', '/recipes/new');
    });

    test('searches as you type, keeps the search in the address, and can clear it', async () => {
        const fetchMock = mockApi([
            ['GET', '/api/recipes', (url) => (url.searchParams.get('search') === 'lasagne' ? page([]) : page([beefChiliSummary]))],
        ]);
        const { router, user } = renderApp('/');
        await screen.findByRole('link', { name: /Beef Chili/ });

        await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'lasagne');

        expect(await screen.findByText('No recipes match “lasagne”')).toBeInTheDocument();
        expect(router.state.location.search).toBe('?q=lasagne');
        expect(requestedUrls(fetchMock).at(-1)?.searchParams.get('search')).toBe('lasagne');

        await user.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(await screen.findByRole('link', { name: /Beef Chili/ })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('');
        expect(router.state.location.search).toBe('');
    });

    test('opens with the search from the address', async () => {
        const fetchMock = mockApi([['GET', '/api/recipes', page([beefChiliSummary])]]);
        renderApp('/?q=chili');

        expect(await screen.findByText('1 match')).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('chili');
        expect(requestedUrls(fetchMock)[0]?.searchParams.get('search')).toBe('chili');
    });

    test("says it can't reach the server, and Retry tries again", async () => {
        let online = false;
        mockApi([['GET', '/api/recipes', () => (online ? page([beefChiliSummary]) : unreachable())]]);
        const { user } = renderApp('/');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Can't reach the server. Check Tailscale is connected, then try again.");

        online = true;
        await user.click(within(alert).getByRole('button', { name: 'Retry' }));

        expect(await screen.findByRole('link', { name: /Beef Chili/ })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('loads the next page as the end of the list comes near', async () => {
        const all = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => summary(`Recipe ${String(i + 1).padStart(2, '0')}`));
        const fetchMock = mockApi([
            [
                'GET',
                '/api/recipes',
                (url) => {
                    const offset = Number(url.searchParams.get('offset'));
                    return page(all.slice(offset, offset + PAGE_SIZE), all.length);
                },
            ],
        ]);
        renderApp('/');

        const list = await screen.findByRole('list', { name: 'Recipes' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(PAGE_SIZE);
        expect(screen.getByText(`${all.length} recipes`)).toBeInTheDocument();

        scrollNearEnd();

        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(all.length));
        expect(requestedUrls(fetchMock).map((url) => url.searchParams.get('offset'))).toEqual(['0', String(PAGE_SIZE)]);
        // Everything is loaded, so there's nothing left to watch for
        expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
    });

    test('a page that fails to load waits for Retry', async () => {
        const all = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => summary(`Dish ${i}`));
        let secondPageWorks = false;
        mockApi([
            [
                'GET',
                '/api/recipes',
                (url) => {
                    const offset = Number(url.searchParams.get('offset'));
                    if (offset > 0 && !secondPageWorks) return json({ error: 'Something went wrong.' }, { status: 500 });
                    return page(all.slice(offset, offset + PAGE_SIZE), all.length);
                },
            ],
        ]);
        const { user } = renderApp('/');
        const list = await screen.findByRole('list', { name: 'Recipes' });

        scrollNearEnd();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Something went wrong.');
        expect(within(list).getAllByRole('listitem')).toHaveLength(PAGE_SIZE);

        secondPageWorks = true;
        await user.click(within(alert).getByRole('button', { name: 'Retry' }));

        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(all.length));
    });

    test("each row's ⋮ menu offers Edit, Print and Delete, and works from the keyboard", async () => {
        mockApi([['GET', '/api/recipes', page([beefChiliSummary])]]);
        const { user } = renderApp('/');

        const button = await screen.findByRole('button', { name: 'More options for Beef Chili' });
        expect(button).toHaveAttribute('aria-expanded', 'false');

        await user.click(button);
        const menu = screen.getByRole('menu', { name: 'More options for Beef Chili' });
        const items = within(menu).getAllByRole('menuitem');
        expect(items.map((item) => item.textContent)).toEqual(['Edit', 'Print', 'Delete recipe…']);
        expect(items[0]).toHaveAttribute('href', `/recipes/${beefChiliSummary.id}/edit`);
        expect(items[1]).toHaveAttribute('href', `/recipes/${beefChiliSummary.id}?print`);
        expect(items[0]).toHaveFocus();

        await user.keyboard('{ArrowDown}');
        expect(items[1]).toHaveFocus();
        await user.keyboard('{End}');
        expect(items[2]).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(items[0]).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(button).toHaveFocus();
    });

    test('a tap outside the menu closes it', async () => {
        mockApi([['GET', '/api/recipes', page([beefChiliSummary])]]);
        const { user } = renderApp('/');

        await user.click(await screen.findByRole('button', { name: 'More options for Beef Chili' }));
        expect(screen.getByRole('menu')).toBeInTheDocument();

        await user.click(screen.getByRole('heading', { name: 'Recipes' }));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    test("Delete in a row's menu asks first, then deletes and refreshes the list", async () => {
        let recipes = [bananaBread, beefChiliSummary];
        const fetchMock = mockApi([
            ['GET', '/api/recipes', () => page(recipes)],
            [
                'DELETE',
                `/api/recipes/${beefChiliSummary.id}`,
                () => {
                    recipes = [bananaBread];
                    return json({ message: 'Recipe deleted successfully.' });
                },
            ],
        ]);
        const { user } = renderApp('/');

        await user.click(await screen.findByRole('button', { name: 'More options for Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete recipe…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete Beef Chili?' });

        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(sent(fetchMock, 'DELETE')).toEqual([]);

        await user.click(screen.getByRole('button', { name: 'More options for Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete recipe…' }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(screen.queryByRole('link', { name: /Beef Chili/ })).not.toBeInTheDocument());
        expect(screen.getByText('1 recipe')).toBeInTheDocument();
        // From the list there's no ETag to send
        expect(sent(fetchMock, 'DELETE')[0]?.headers['If-Match']).toBeUndefined();
    });
});
