import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Ingredient } from '../api/types';
import { mockApi, page, renderApp } from '../test/renderApp';

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
});
