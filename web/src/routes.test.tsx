import { beforeEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { BEEF_CHILI_ID, beefChili, beefChiliSummary } from './test/fixtures';
import { json, mockApi, page, renderApp } from './test/renderApp';

beforeEach(() => {
    mockApi([
        ['GET', '/api/recipes', page([beefChiliSummary])],
        ['GET', `/api/recipes/${BEEF_CHILI_ID}`, json(beefChili)],
        ['GET', '/api/ingredients', page([])],
        ['GET', '/api/health', json({ status: 'ok' })],
    ]);
});

describe('routes', () => {
    test.each([
        ['/', 'Recipes'],
        ['/recipes/new', 'New recipe'],
        [`/recipes/${BEEF_CHILI_ID}`, 'Beef Chili'],
        [`/recipes/${BEEF_CHILI_ID}/edit`, 'Edit recipe'],
        ['/options', 'Options'],
        ['/options/ingredients', 'Ingredients'],
        ['/no-such-page', 'Page not found'],
    ])('%s shows the "%s" page', async (path, heading) => {
        renderApp(path);

        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    });

    test('every page has the header: home, Refresh and Options', async () => {
        renderApp('/');

        expect(await screen.findByRole('link', { name: 'Mise en place' })).toHaveAttribute('href', '/');
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Options' })).toHaveAttribute('href', '/options');
    });
});
