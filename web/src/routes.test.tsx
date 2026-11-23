import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { routes } from './routes';

/** Render the app at a path, as a deep link would. */
function renderAt(path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
        <QueryClientProvider client={new QueryClient()}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
}

describe('routes', () => {
    test.each([
        ['/', 'Recipes'],
        ['/recipes/new', 'New recipe'],
        ['/recipes/2c7a9e4e-1d3f-4b5a-9c8d-7e6f5a4b3c2d', 'Recipe'],
        ['/recipes/2c7a9e4e-1d3f-4b5a-9c8d-7e6f5a4b3c2d/edit', 'Edit recipe'],
        ['/options', 'Options'],
        ['/options/ingredients', 'Ingredients'],
        ['/no-such-page', 'Page not found'],
    ])('%s shows the "%s" page', async (path, heading) => {
        renderAt(path);

        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    });

    test('every page has the header, with a way home and to Options', async () => {
        renderAt('/options/ingredients');

        expect(await screen.findByRole('link', { name: 'Mise en place' })).toHaveAttribute('href', '/');
        expect(screen.getByRole('link', { name: 'Options' })).toHaveAttribute('href', '/options');
    });
});
