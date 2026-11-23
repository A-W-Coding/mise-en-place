import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Ingredient } from '../api/types';
import { json, mockApi, page, renderApp, sent } from '../test/renderApp';

function ingredient(name: string): Ingredient {
    return { id: `id-${name}`, name, createdAt: '2026-11-23T10:00:00.000Z', updatedAt: '2026-11-23T10:00:00.000Z' };
}

describe('IngredientsPage', () => {
    test('lists the shared ingredients, and searches them', async () => {
        mockApi([
            [
                'GET',
                '/api/ingredients',
                (url) =>
                    url.searchParams.get('search') === 'gar'
                        ? page([ingredient('garlic')])
                        : page([ingredient('garlic'), ingredient('onion')]),
            ],
        ]);
        const { user } = renderApp('/options/ingredients');

        const list = await screen.findByRole('list', { name: 'Ingredients' });
        expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['garlic', 'onion']);
        expect(screen.getByText('2 ingredients')).toBeInTheDocument();

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'gar');

        expect(await screen.findByText('1 match')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to Options' })).toHaveAttribute('href', '/options');
    });

    test('says when nothing matches', async () => {
        mockApi([['GET', '/api/ingredients', page([])]]);
        renderApp('/options/ingredients?q=saffron');

        expect(await screen.findByText('No ingredients match “saffron”')).toBeInTheDocument();
    });
    test('renames an ingredient, and says when the name is taken', async () => {
        let names = ['garlic', 'onion'];
        const fetchMock = mockApi([
            ['GET', '/api/ingredients', () => page(names.map((name) => ingredient(name)))],
            [
                'PATCH',
                '/api/ingredients/id-garlic',
                (_url, init) => {
                    const { name } = JSON.parse(String(init.body)) as { name: string };
                    if (name === 'onion') return json({ error: 'That name already exists.' }, { status: 409 });
                    names = [name, 'onion'];
                    return json(ingredient(name));
                },
            ],
        ]);
        const { user } = renderApp('/options/ingredients');

        await user.click(await screen.findByRole('button', { name: 'More options for garlic' }));
        await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
        const box = screen.getByLabelText('Rename “garlic”');
        expect(box).toHaveFocus();

        await user.clear(box);
        await user.type(box, 'Onion{Enter}');
        expect(await screen.findByText('Another ingredient is already called “onion”.')).toBeInTheDocument();

        await user.clear(box);
        await user.type(box, 'garlic clove{Enter}');

        const list = screen.getByRole('list', { name: 'Ingredients' });
        await waitFor(() =>
            expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['garlic clove', 'onion']),
        );
        expect(sent(fetchMock, 'PATCH').map((request) => request.body)).toEqual([{ name: 'onion' }, { name: 'garlic clove' }]);
    });

    test('deleting an ingredient a recipe uses says why it was refused', async () => {
        mockApi([
            ['GET', '/api/ingredients', page([ingredient('onion')])],
            ['DELETE', '/api/ingredients/id-onion', json({ error: 'Cannot delete ingredient that is used in recipes.' }, { status: 409 })],
        ]);
        const { user } = renderApp('/options/ingredients');

        await user.click(await screen.findByRole('button', { name: 'More options for onion' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete “onion”?' });
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

        expect(await screen.findByRole('alert')).toHaveTextContent("Can't delete “onion”: a recipe still uses it.");
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('deletes an unused ingredient', async () => {
        let names = ['onion', 'saffron'];
        mockApi([
            ['GET', '/api/ingredients', () => page(names.map((name) => ingredient(name)))],
            [
                'DELETE',
                '/api/ingredients/id-saffron',
                () => {
                    names = ['onion'];
                    return json({ message: 'Ingredient deleted successfully.' });
                },
            ],
        ]);
        const { user } = renderApp('/options/ingredients');

        await user.click(await screen.findByRole('button', { name: 'More options for saffron' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(screen.queryByText('saffron')).not.toBeInTheDocument());
        expect(screen.getByText('1 ingredient')).toBeInTheDocument();
    });
});
