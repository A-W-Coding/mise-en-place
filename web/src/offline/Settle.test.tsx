import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { buildRecipeBody, draftFromRecipe, type DraftBody } from '../editor/draft';
import { fakeServer } from '../test/fakeServer';
import { BEEF_CHILI_ID, beefChili, etagOf, seedCopy } from '../test/fixtures';
import { renderApp, sent } from '../test/renderApp';
import { copyName } from './settle';
import { startSync } from './sync';
import { getWaitingState, keepWaitingChange, loadWaitingChanges, markProblem, type ChangeProblem } from './waiting';

const NEW_ID = 'dddddddd-0000-4000-8000-000000000004';

function chiliBody(changes: Partial<DraftBody> = {}): DraftBody {
    const result = buildRecipeBody(draftFromRecipe(beefChili));
    if ('errors' in result) throw new Error('Expected a body.');
    return { ...result.body, ...changes };
}

/** Beef Chili edited on this device ("Mine."), whose upload met `problem`. */
async function stuckEdit(problem: ChangeProblem, body = chiliBody({ description: 'Mine.' })) {
    await keepWaitingChange({ recipeId: BEEF_CHILI_ID, kind: 'edit', body, etag: etagOf(beefChili) });
    const [change] = await loadWaitingChanges();
    await markProblem(change!, problem);
}

/** Open Beef Chili's page with the sync running, as the app does. */
function openChili(path = `/recipes/${BEEF_CHILI_ID}`) {
    const rendered = renderApp(path);
    startSync(rendered.queryClient);
    return rendered;
}

const panel = () => screen.findByRole('region', { name: 'Needs your attention' });

describe('a change made elsewhere meanwhile (412)', () => {
    async function setUp() {
        const server = fakeServer({ recipes: [beefChili] });
        server.changeElsewhere(BEEF_CHILI_ID, { description: 'Theirs.' });
        await stuckEdit({ kind: 'changed' });
        return server;
    }

    test('shows both versions: yours, and theirs at a tap', async () => {
        await setUp();
        const { user } = openChili();

        const settle = await panel();
        expect(screen.getByText('Mine.')).toBeInTheDocument();
        expect(within(settle).getByRole('button', { name: 'Yours' })).toHaveAttribute('aria-pressed', 'true');

        await user.click(within(settle).getByRole('button', { name: 'Theirs' }));
        expect(await screen.findByText('Theirs.')).toBeInTheDocument();
        expect(screen.queryByText('Mine.')).not.toBeInTheDocument();
        expect(within(settle).getByRole('button', { name: 'Theirs' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('Keep mine asks first, then saves yours over theirs, with the ETag of theirs', async () => {
        const server = await setUp();
        const theirsEtag = server.etagOf(server.recipes.get(BEEF_CHILI_ID)!);
        const { user } = openChili();

        await user.click(within(await panel()).getByRole('button', { name: 'Keep mine' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Save yours over theirs?' });
        expect(dialog).toHaveTextContent('The changes made on the other device will be lost.');
        await user.click(within(dialog).getByRole('button', { name: 'Keep mine' }));

        await waitFor(() => expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Mine.'));
        expect(sent(server.fetchMock, 'PATCH').at(-1)?.headers['If-Match']).toBe(theirsEtag);
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Needs your attention' })).not.toBeInTheDocument());
        expect(await loadWaitingChanges()).toEqual([]);
    });

    test('Keep theirs asks first, and Cancel keeps both as they are', async () => {
        const server = await setUp();
        const { user } = openChili();

        await user.click(within(await panel()).getByRole('button', { name: 'Keep theirs' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Keep theirs, and discard yours?' });
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(getWaitingState().changes).toHaveLength(1);

        await user.click(within(await panel()).getByRole('button', { name: 'Keep theirs' }));
        await user.click(
            within(await screen.findByRole('alertdialog', { name: 'Keep theirs, and discard yours?' })).getByRole('button', {
                name: 'Discard mine',
            }),
        );

        expect(await screen.findByText('Theirs.')).toBeInTheDocument();
        expect(getWaitingState().changes).toEqual([]);
        expect(sent(server.fetchMock, 'PATCH')).toEqual([]);
        expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Theirs.');
    });

    test('Keep both saves yours as a new recipe, with "(copy)" after its name, and leaves theirs', async () => {
        const server = await setUp();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(NEW_ID);
        const { user, router } = openChili();

        await user.click(within(await panel()).getByRole('button', { name: 'Keep both' }));

        await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${NEW_ID}`));
        await waitFor(() => expect(server.recipes.get(NEW_ID)?.name).toBe('Beef Chili (copy)'));
        expect(server.recipes.get(NEW_ID)).toMatchObject({ description: 'Mine.' });
        expect(server.recipes.get(NEW_ID)?.recipeIngredients).toHaveLength(beefChili.recipeIngredients.length);
        expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Theirs.');
        expect(await loadWaitingChanges()).toEqual([]);
    });

    test('works offline too: Keep mine waits on the device, and uploads once the server is back', async () => {
        const server = await setUp();
        // The copy has their version, with its ETag
        await seedCopy([server.recipes.get(BEEF_CHILI_ID)!]);
        server.reachable = false;
        const { user } = openChili();

        await user.click(within(await panel()).getByRole('button', { name: 'Keep mine' }));
        await user.click(
            within(await screen.findByRole('alertdialog', { name: 'Save yours over theirs?' })).getByRole('button', {
                name: 'Keep mine',
            }),
        );
        expect(await screen.findByText(/Waiting to upload\./)).toBeInTheDocument();

        server.reachable = true;
        await user.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Mine.'));
    });
});

describe('a recipe deleted elsewhere meanwhile (404)', () => {
    test('can be saved as a new recipe, with a new id', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.recipes.delete(BEEF_CHILI_ID);
        await stuckEdit({ kind: 'deleted' });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(NEW_ID);
        const { user, router } = openChili();

        await user.click(within(await panel()).getByRole('button', { name: 'Save as a new recipe' }));

        await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${NEW_ID}`));
        await waitFor(() => expect(server.recipes.get(NEW_ID)).toMatchObject({ name: 'Beef Chili', description: 'Mine.' }));
        expect(await loadWaitingChanges()).toEqual([]);
    });

    test('or discarded, after asking first', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.recipes.delete(BEEF_CHILI_ID);
        await stuckEdit({ kind: 'deleted' });
        const { user, router } = openChili();

        await user.click(within(await panel()).getByRole('button', { name: 'Discard' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Discard your version?' });
        await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

        await waitFor(() => expect(router.state.location.pathname).toBe('/'));
        expect(getWaitingState().changes).toEqual([]);
        expect(server.recipes.size).toBe(0);
    });
});

describe('a change the API refused (400)', () => {
    test("opens in the editor with the API's messages beside their fields, and saving again uploads it", async () => {
        const server = fakeServer({ recipes: [beefChili] });
        await stuckEdit(
            { kind: 'refused', message: 'Validation failed.', fields: { servings: 'Must be at most 1000.' } },
            chiliBody({ servings: 2000 }),
        );
        const { user, router } = openChili();

        expect(await panel()).toHaveTextContent("The server didn't accept this version (Validation failed.)");
        await user.click(within(await panel()).getByRole('link', { name: 'Edit it' }));

        const serves = await screen.findByLabelText('Serves');
        expect(serves).toHaveValue('2000');
        expect(serves).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Must be at most 1000.')).toBeInTheDocument();
        await waitFor(() => expect(serves).toHaveFocus());

        await user.clear(serves);
        await user.type(serves, '4');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${BEEF_CHILI_ID}`));
        await waitFor(() => expect(server.recipes.get(BEEF_CHILI_ID)?.servings).toBe(4));
        expect(await loadWaitingChanges()).toEqual([]);
    });

    test("names an ingredient deleted elsewhere, which the API can't put beside a box", async () => {
        fakeServer({ recipes: [beefChili] });
        await stuckEdit({ kind: 'refused', message: 'One or more ingredient IDs are invalid.', fields: {} });
        renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        // Beside the attention banner, the editor's own summary says what to do
        expect(
            await screen.findByText('An ingredient on this recipe was deleted elsewhere. Choose it again, then save.'),
        ).toHaveAttribute('role', 'alert');
    });
});

describe('copyName', () => {
    test('adds "(copy)", shortening a long name to fit the limit', () => {
        expect(copyName('Beef Chili')).toBe('Beef Chili (copy)');
        const long = copyName('x'.repeat(200));
        expect(long).toHaveLength(200);
        expect(long.endsWith(' (copy)')).toBe(true);
    });
});
