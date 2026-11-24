import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildRecipeBody, draftFromRecipe, type DraftBody } from '../editor/draft';
import { fakeServer } from '../test/fakeServer';
import { BEEF_CHILI_ID, beefChili, etagOf, seedCopy } from '../test/fixtures';
import { json, mockApi, renderApp, unreachable } from '../test/renderApp';
import { startSync } from './sync';
import { getWaitingState, keepWaitingChange, loadWaitingChanges, markProblem } from './waiting';

const TOAST_ID = 'cccccccc-0000-4000-8000-000000000003';

function chiliBody(changes: Partial<DraftBody> = {}): DraftBody {
    const result = buildRecipeBody(draftFromRecipe(beefChili));
    if ('errors' in result) throw new Error('Expected a body.');
    return { ...result.body, ...changes };
}

afterEach(() => {
    delete (navigator as { storage?: unknown }).storage;
});

describe('editing offline (Step 17)', () => {
    test('a new recipe with a new ingredient is kept on the device, and shows at once, marked waiting', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.reachable = false;
        await seedCopy([beefChili]);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(TOAST_ID);
        const { user } = renderApp('/recipes/new');

        await user.type(await screen.findByLabelText('Name'), 'Sourdough Toast');
        await user.type(screen.getByLabelText('Amount, line 1'), '2');
        // Suggestions come from the copy; there's no sourdough in it, so it's created when the recipe uploads
        await user.type(screen.getByRole('combobox', { name: 'Ingredient, line 1' }), 'sourdough');
        await user.click(await screen.findByRole('option', { name: 'Create ingredient “sourdough”' }));
        expect(await screen.findByText(/^New: it's added to the ingredient list/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Sourdough Toast' })).toBeInTheDocument();
        expect(screen.getByText(/Waiting to upload\./).closest('[role="status"]')).toHaveTextContent(
            'Waiting to upload. Saved on this device just now. It uploads by itself once the server can be reached.',
        );
        expect(within(screen.getByRole('region', { name: 'Ingredients' })).getByRole('listitem')).toHaveTextContent('2sourdough');

        // The list shows it above the rest
        await user.click(screen.getByRole('link', { name: 'Back to Recipes' }));
        const waiting = await screen.findByRole('list', { name: 'Waiting to upload' });
        expect(within(waiting).getByRole('link', { name: /Sourdough Toast/ })).toHaveAttribute('href', `/recipes/${TOAST_ID}`);
        expect(within(screen.getByRole('list', { name: 'Recipes' })).getByRole('link', { name: /Beef Chili/ })).toBeInTheDocument();

        const [change] = getWaitingState().changes;
        expect(change).toMatchObject({ kind: 'create', etag: null, body: { name: 'Sourdough Toast' } });
        expect(change?.body.ingredients[0]).toMatchObject({ ingredientId: null, ingredientName: 'sourdough', quantity: 2 });
    });

    test('an edit is kept with the ETag it started from, and the page, the list and the editor show that version', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.reachable = false;
        await seedCopy([beefChili]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        const description = await screen.findByLabelText('Description');
        await user.clear(description);
        await user.type(description, 'Hotter.');
        await user.clear(screen.getByLabelText('Name'));
        await user.type(screen.getByLabelText('Name'), 'Beef Chili, hotter');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Beef Chili, hotter' })).toBeInTheDocument();
        expect(screen.getByText('Hotter.')).toBeInTheDocument();
        expect(screen.getByText(/Waiting to upload\./)).toBeInTheDocument();
        expect(getWaitingState().changes[0]).toMatchObject({ kind: 'edit', etag: etagOf(beefChili) });

        await user.click(screen.getByRole('link', { name: 'Back to Recipes' }));
        const row = await screen.findByRole('link', { name: /Beef Chili, hotter/ });
        expect(row).toHaveTextContent('Waiting to upload');

        // Editing it again edits the waiting version
        await user.click(screen.getByRole('button', { name: 'More options for Beef Chili, hotter' }));
        await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
        expect(await screen.findByLabelText('Description')).toHaveValue('Hotter.');
    });

    test('once the server can be reached, waiting changes upload by themselves and the marks go', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.reachable = false;
        await seedCopy([beefChili]);
        await keepWaitingChange({
            recipeId: BEEF_CHILI_ID,
            kind: 'edit',
            body: chiliBody({ description: 'Hotter.' }),
            etag: etagOf(beefChili),
        });
        const { queryClient, user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        startSync(queryClient);
        expect(await screen.findByText(/Waiting to upload\./)).toBeInTheDocument();

        server.reachable = true;
        await user.click(screen.getByRole('button', { name: 'Refresh' }));

        await waitFor(() => expect(screen.queryByText(/Waiting to upload\./)).not.toBeInTheDocument());
        expect(screen.getByText('Hotter.')).toBeInTheDocument();
        expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Hotter.');
        expect(await loadWaitingChanges()).toEqual([]);
    });

    test("a change that couldn't upload shows a banner on every page, and says why on its own", async () => {
        mockApi([
            ['GET', '/api/recipes', () => unreachable()],
            ['GET', `/api/recipes/${BEEF_CHILI_ID}`, () => unreachable()],
        ]);
        await seedCopy([beefChili]);
        await keepWaitingChange({ recipeId: BEEF_CHILI_ID, kind: 'edit', body: chiliBody(), etag: etagOf(beefChili) });
        const [change] = await loadWaitingChanges();
        await markProblem(change!, { kind: 'changed' });
        const { user } = renderApp('/');

        const banner = await screen.findByRole('alert');
        expect(banner).toHaveTextContent("A change couldn't be uploaded. It's kept on this device until you look: Beef Chili.");
        const list = await screen.findByRole('list', { name: 'Recipes' });
        expect(within(list).getByRole('link', { name: /Beef Chili/ })).toHaveTextContent('Needs your attention');

        await user.click(within(banner).getByRole('link', { name: 'Beef Chili' }));
        expect(await screen.findByRole('region', { name: 'Needs your attention' })).toHaveTextContent(
            "Needs your attention. This recipe was changed on another device after you started editing it, so yours wasn't saved over theirs.",
        );
    });

    test('Options counts the changes waiting, and why protecting the copy matters more now', async () => {
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: { persisted: async () => false, persist: async () => true },
        });
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        await seedCopy([beefChili]);
        await keepWaitingChange({ recipeId: BEEF_CHILI_ID, kind: 'edit', body: chiliBody(), etag: etagOf(beefChili) });
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: chiliBody({ name: 'Toast' }), etag: null });
        const [chili] = await loadWaitingChanges();
        await markProblem(chili!, { kind: 'deleted' });
        renderApp('/options');

        const section = await screen.findByRole('region', { name: 'Offline copy' });
        expect(await within(section).findByText('2 changes waiting to upload, 1 of them needing your attention.')).toBeInTheDocument();
        expect(
            await within(section).findByText(
                'Not protected: the browser may clear it if this device runs low on space. Changes waiting to upload would go with it.',
            ),
        ).toBeInTheDocument();
    });
});

describe('what still needs a connection', () => {
    test('deleting a recipe offline says so', async () => {
        mockApi([
            ['GET', `/api/recipes/${BEEF_CHILI_ID}`, () => unreachable()],
            ['DELETE', `/api/recipes/${BEEF_CHILI_ID}`, () => unreachable()],
        ]);
        await seedCopy([beefChili]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('button', { name: 'More options for Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete recipe…' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

        expect(
            await screen.findByText('Deleting a recipe needs a connection to the server. Check Tailscale is connected, then try again.'),
        ).toBeInTheDocument();
    });

    test('renaming an ingredient offline says so', async () => {
        mockApi([
            ['GET', '/api/ingredients', () => unreachable()],
            ['PATCH', /^\/api\/ingredients\//, () => unreachable()],
        ]);
        await seedCopy([beefChili]);
        const { user } = renderApp('/options/ingredients');

        await user.click(await screen.findByRole('button', { name: 'More options for garlic' }));
        await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
        await user.type(screen.getByLabelText('Rename “garlic”'), ' clove{Enter}');

        expect(
            await screen.findByText(
                'Renaming an ingredient needs a connection to the server. Check Tailscale is connected, then try again.',
            ),
        ).toBeInTheDocument();
    });

    test('deleting a new recipe that never left the device drops it', async () => {
        fakeServer();
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: chiliBody({ name: 'Toast', ingredients: [] }), etag: null });
        const { user, router } = renderApp(`/recipes/${TOAST_ID}`);

        await user.click(await screen.findByRole('button', { name: 'More options for Toast' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete recipe…' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(router.state.location.pathname).toBe('/'));
        await waitFor(() => expect(getWaitingState().changes).toEqual([]));
    });
});
