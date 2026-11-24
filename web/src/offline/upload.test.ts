import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import { ApiError } from '../api/client';
import type { Recipe } from '../api/types';
import { buildRecipeBody, draftFromRecipe, type DraftBody } from '../editor/draft';
import { fakeServer } from '../test/fakeServer';
import { BEEF_CHILI_ID, beefChili, etagOf, seedCopy } from '../test/fixtures';
import { json, mockApi, sent } from '../test/renderApp';
import { getOfflineCopyState } from './copy';
import { recipeFromChange, uploadWaitingChanges } from './upload';
import { memoryStorage, setOfflineStorage } from './storage';
import { keepWaitingChange, loadWaitingChanges, resetWaitingChanges } from './waiting';

const TOAST_ID = 'cccccccc-0000-4000-8000-000000000003';

/** A recipe as the editor would save it, unchanged. */
function bodyOf(recipe: Recipe): DraftBody {
    const result = buildRecipeBody(draftFromRecipe(recipe));
    if ('errors' in result) throw new Error('Expected a body.');
    return result.body;
}

/** A new recipe with an ingredient created offline. */
function toast(name = 'Sourdough Toast'): DraftBody {
    return {
        name,
        description: null,
        servings: 1,
        prepTime: null,
        cookTime: null,
        sections: [{ name: 'Method', steps: [{ text: 'Toast it.', timerSeconds: null }] }],
        ingredients: [
            {
                ingredientId: null,
                ingredientName: 'sourdough',
                quantity: 2,
                quantityMax: null,
                unit: null,
                note: 'sliced',
                sectionIndex: null,
            },
        ],
    };
}

async function afterReload() {
    resetWaitingChanges();
    return loadWaitingChanges();
}

function writes(server: ReturnType<typeof fakeServer>): string[] {
    return server.fetchMock.mock.calls
        .filter(([, init]) => init?.method && init.method !== 'GET')
        .map(([input, init]) => `${init?.method} ${new URL(String(input), 'http://localhost').pathname}`);
}

const upload = () => uploadWaitingChanges(new QueryClient());

describe('uploadWaitingChanges', () => {
    test('uploads oldest first: new ingredients, then a POST with the id, or a PATCH with If-Match', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        await seedCopy([beefChili]);
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast(), etag: null }, { now: 1 });
        await keepWaitingChange(
            { recipeId: BEEF_CHILI_ID, kind: 'edit', body: { ...bodyOf(beefChili), description: 'Hotter.' }, etag: etagOf(beefChili) },
            { now: 2 },
        );

        await upload();

        expect(writes(server)).toEqual(['POST /api/ingredients', 'POST /api/recipes', `PATCH /api/recipes/${BEEF_CHILI_ID}`]);
        expect(sent(server.fetchMock, 'POST')[1]?.body).toMatchObject({ id: TOAST_ID, name: 'Sourdough Toast' });
        expect(sent(server.fetchMock, 'PATCH')[0]?.headers['If-Match']).toBe(etagOf(beefChili));
        expect(server.recipes.get(TOAST_ID)?.recipeIngredients[0]?.ingredient.name).toBe('sourdough');
        expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Hotter.');
        expect(await afterReload()).toEqual([]);

        // Each reply went into the offline copy at once, with its new ETag
        const copy = getOfflineCopyState().copy!;
        expect(copy.data.recipes.map((recipe) => recipe.name)).toEqual(['Beef Chili', 'Sourdough Toast']);
        expect(copy.data.etags[BEEF_CHILI_ID]).toBe(server.etagOf(server.recipes.get(BEEF_CHILI_ID)!));
        expect(copy.data.ingredients.map((ingredient) => ingredient.name)).toContain('sourdough');
    });

    test('a new ingredient created elsewhere meanwhile (409) is the one used', async () => {
        const server = fakeServer();
        const stamp = '2026-11-24T09:00:00.000Z';
        server.ingredients.set('existing-sourdough', { id: 'existing-sourdough', name: 'sourdough', createdAt: stamp, updatedAt: stamp });
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast(), etag: null });

        await upload();

        expect(server.recipes.get(TOAST_ID)?.recipeIngredients[0]?.ingredientId).toBe('existing-sourdough');
        expect([...server.ingredients.values()].filter((ingredient) => ingredient.name === 'sourdough')).toHaveLength(1);
    });

    test('a create whose answer was lost counts as uploaded on the retry, with no second copy', async () => {
        const server = fakeServer();
        server.loseAnswer('POST', '/api/recipes');
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast(), etag: null });

        await expect(upload()).rejects.toMatchObject({ isNetworkError: true });
        expect(server.recipes.has(TOAST_ID)).toBe(true);
        expect((await afterReload())[0]?.sent).toEqual([toast()]);

        await upload();

        expect(writes(server).filter((write) => write.includes('/api/recipes'))).toEqual(['POST /api/recipes', 'POST /api/recipes']);
        expect([...server.recipes.values()].filter((recipe) => recipe.name === 'Sourdough Toast')).toHaveLength(1);
        expect(await afterReload()).toEqual([]);
    });

    test('a create that arrived with its answer lost, then edited again offline: the newer version is saved over it', async () => {
        const server = fakeServer();
        server.loseAnswer('POST', '/api/recipes');
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast(), etag: null }, { now: 1 });
        await expect(upload()).rejects.toThrow();
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast('Better Toast'), etag: null }, { now: 2 });

        await upload();

        // POST, 409, read it back: it's the version sent before, so the new one goes over it
        expect(server.recipes.get(TOAST_ID)?.name).toBe('Better Toast');
        expect(sent(server.fetchMock, 'PATCH')[0]?.headers['If-Match']).toBeDefined();
        expect(await afterReload()).toEqual([]);
    });

    test('an edit whose answer was lost counts as uploaded on the retry, not as a change made elsewhere', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.loseAnswer('PATCH', `/api/recipes/${BEEF_CHILI_ID}`);
        const edited = { ...bodyOf(beefChili), description: 'Hotter.' };
        await keepWaitingChange({ recipeId: BEEF_CHILI_ID, kind: 'edit', body: edited, etag: etagOf(beefChili) });
        await expect(upload()).rejects.toThrow();

        // The retry's If-Match is now stale (412), but the recipe is already this version
        await upload();

        expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Hotter.');
        expect(await afterReload()).toEqual([]);
    });

    test('an edit to a recipe changed elsewhere meanwhile is kept and marked, and not saved over it', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        await keepWaitingChange({
            recipeId: BEEF_CHILI_ID,
            kind: 'edit',
            body: { ...bodyOf(beefChili), description: 'Mine.' },
            etag: etagOf(beefChili),
        });
        server.changeElsewhere(BEEF_CHILI_ID, { description: 'Theirs.' });

        await upload();

        expect(server.recipes.get(BEEF_CHILI_ID)?.description).toBe('Theirs.');
        const [change] = await afterReload();
        expect(change).toMatchObject({ problem: { kind: 'changed' }, body: { description: 'Mine.' } });

        // It waits for you now: the next round doesn't send it again
        server.fetchMock.mockClear();
        await upload();
        expect(writes(server)).toEqual([]);
    });

    test('an edit to a recipe deleted elsewhere (404), and a change the API refuses (400), are kept and marked', async () => {
        const server = fakeServer({ recipes: [beefChili] });
        await keepWaitingChange({ recipeId: BEEF_CHILI_ID, kind: 'edit', body: bodyOf(beefChili), etag: etagOf(beefChili) }, { now: 1 });
        const goneIngredient = { ...toast(), ingredients: [{ ...toast().ingredients[0]!, ingredientId: 'deleted-elsewhere' }] };
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: goneIngredient, etag: null }, { now: 2 });
        server.recipes.delete(BEEF_CHILI_ID);

        await upload();

        const changes = await afterReload();
        expect(changes.map((change) => change.problem)).toEqual([
            { kind: 'deleted' },
            { kind: 'refused', message: 'One or more ingredient IDs are invalid.', fields: {} },
        ]);
    });

    test("when the Pi can't be reached the round stops, and every change waits, through a reload", async () => {
        const server = fakeServer({ recipes: [beefChili] });
        server.reachable = false;
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast(), etag: null }, { now: 1 });
        await keepWaitingChange({ recipeId: BEEF_CHILI_ID, kind: 'edit', body: bodyOf(beefChili), etag: etagOf(beefChili) }, { now: 2 });

        await expect(upload()).rejects.toMatchObject({ isNetworkError: true });

        // Only the first was tried
        expect(server.fetchMock).toHaveBeenCalledTimes(1);
        expect((await afterReload()).map((change) => [change.recipeId, change.problem])).toEqual([
            [TOAST_ID, null],
            [BEEF_CHILI_ID, null],
        ]);
    });

    test('a server error stops the round too, to try again later', async () => {
        mockApi([['POST', '/api/recipes', json({ error: 'Something went wrong.' }, { status: 500 })]]);
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: { ...toast(), ingredients: [] }, etag: null });

        await expect(upload()).rejects.toBeInstanceOf(ApiError);

        expect((await afterReload())[0]?.problem).toBeNull();
    });
});

describe('a change saved before 3b', () => {
    test('is converted on load, and uploads with its method as a "Method" section', async () => {
        const server = fakeServer();
        const stored = {
            recipeId: TOAST_ID,
            kind: 'create',
            etag: null,
            createdAt: 1,
            savedAt: 1,
            sent: [],
            problem: null,
            body: {
                name: 'Old Toast',
                description: null,
                servings: 1,
                prepTime: null,
                cookTime: null,
                instructions: '1. Toast it.\n2. Butter it.',
                ingredients: [],
            },
        };
        const storage = memoryStorage();
        await storage.setMany([['waitingChanges', [stored]]]);
        setOfflineStorage(storage);
        resetWaitingChanges();

        await upload();

        const uploaded = server.recipes.get(TOAST_ID);
        expect(uploaded?.sections.map((section) => [section.name, section.steps.map((step) => step.text)])).toEqual([
            ['Method', ['Toast it.', 'Butter it.']],
        ]);
        expect(await afterReload()).toEqual([]);
    });
});

describe('recipeFromChange', () => {
    test('shows a waiting change as a whole recipe, new ingredients included', async () => {
        await keepWaitingChange({ recipeId: TOAST_ID, kind: 'create', body: toast(), etag: null }, { now: Date.parse('2026-11-24T08:00:00Z') });
        const [change] = await loadWaitingChanges();

        const recipe = recipeFromChange(change!);

        expect(recipe).toMatchObject({ id: TOAST_ID, name: 'Sourdough Toast', updatedAt: '2026-11-24T08:00:00.000Z' });
        expect(recipe.sections).toMatchObject([{ name: 'Method', steps: [{ text: 'Toast it.', timerSeconds: null }] }]);
        expect(recipe.recipeIngredients[0]).toMatchObject({ quantity: 2, note: 'sliced', ingredient: { name: 'sourdough' } });
    });
});
