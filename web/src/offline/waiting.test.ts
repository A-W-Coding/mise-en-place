import { describe, expect, test } from 'vitest';
import type { DraftBody } from '../editor/draft';
import { memoryStorage, setOfflineStorage } from './storage';
import {
    upgradeBody,
    discardWaitingChange,
    getWaitingState,
    keepWaitingChange,
    loadWaitingChanges,
    markProblem,
    noteSent,
    resetWaitingChanges,
    settleUploaded,
} from './waiting';

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function body(name: string): DraftBody {
    return { name, description: null, servings: 1, prepTime: null, cookTime: null, sections: [], ingredients: [], tags: [], equipment: [] };
}

/** The changes as a fresh start of the app would read them from storage. */
async function afterReload() {
    resetWaitingChanges();
    return loadWaitingChanges();
}

describe('waiting changes', () => {
    test('are kept in the order they were first saved, and survive a reload', async () => {
        await keepWaitingChange({ recipeId: ID_A, kind: 'create', body: body('Toast'), etag: null }, { now: 1 });
        await keepWaitingChange({ recipeId: ID_B, kind: 'edit', body: body('Chili'), etag: '"5"' }, { now: 2 });

        const changes = await afterReload();

        expect(changes.map((change) => [change.recipeId, change.kind, change.etag, change.createdAt])).toEqual([
            [ID_A, 'create', null, 1],
            [ID_B, 'edit', '"5"', 2],
        ]);
    });

    test('one per recipe: saving again replaces it, keeping its place in the queue', async () => {
        await keepWaitingChange({ recipeId: ID_A, kind: 'edit', body: body('Toast'), etag: '"5"' }, { now: 1 });
        await keepWaitingChange({ recipeId: ID_B, kind: 'create', body: body('Chili'), etag: null }, { now: 2 });
        await keepWaitingChange({ recipeId: ID_A, kind: 'edit', body: body('Better Toast'), etag: '"5"' }, { now: 3 });

        const [first, second] = await afterReload();

        expect(first).toMatchObject({ recipeId: ID_A, body: body('Better Toast'), etag: '"5"', createdAt: 1, savedAt: 3 });
        expect(second?.recipeId).toBe(ID_B);
    });

    test('saving again clears a problem, so the new version gets its own try', async () => {
        await keepWaitingChange({ recipeId: ID_A, kind: 'edit', body: body('Toast'), etag: '"5"' }, { now: 1 });
        const [change] = await loadWaitingChanges();
        await markProblem(change!, { kind: 'changed' });
        expect(getWaitingState().changes[0]?.problem).toEqual({ kind: 'changed' });

        await keepWaitingChange({ recipeId: ID_A, kind: 'edit', body: body('Toast'), etag: '"5"' }, { now: 2 });

        expect((await afterReload())[0]?.problem).toBeNull();
    });

    test('remembers each version sent with no answer back, once', async () => {
        const keep = { recipeId: ID_A, kind: 'create' as const, etag: null };
        await keepWaitingChange({ ...keep, body: body('Toast') }, { sent: true, now: 1 });
        await keepWaitingChange({ ...keep, body: body('Toast') }, { sent: true, now: 2 });
        await keepWaitingChange({ ...keep, body: body('Better Toast') }, { now: 3 });

        const [change] = await afterReload();
        expect(change?.sent).toEqual([body('Toast')]);

        await noteSent(change!);
        expect((await afterReload())[0]?.sent).toEqual([body('Toast'), body('Better Toast')]);
    });

    test('once uploaded, a change is done, unless it was saved again meanwhile', async () => {
        await keepWaitingChange({ recipeId: ID_A, kind: 'create', body: body('Toast'), etag: null }, { now: 1 });
        await keepWaitingChange({ recipeId: ID_B, kind: 'create', body: body('Chili'), etag: null }, { now: 2 });
        const [toast, chili] = await loadWaitingChanges();

        // Chili is saved again while its first version uploads
        await keepWaitingChange({ recipeId: ID_B, kind: 'create', body: body('Hot Chili'), etag: null }, { now: 3 });
        await settleUploaded(toast!, '"10"');
        await settleUploaded(chili!, '"11"');

        const changes = await afterReload();
        expect(changes).toHaveLength(1);
        // The newer version is now an edit of the one that uploaded
        expect(changes[0]).toMatchObject({ recipeId: ID_B, kind: 'edit', etag: '"11"', body: body('Hot Chili'), sent: [] });
    });

    test("a problem isn't marked on a change saved again since", async () => {
        await keepWaitingChange({ recipeId: ID_A, kind: 'edit', body: body('Toast'), etag: '"5"' }, { now: 1 });
        const [old] = await loadWaitingChanges();
        await keepWaitingChange({ recipeId: ID_A, kind: 'edit', body: body('Toast 2'), etag: '"5"' }, { now: 2 });

        await markProblem(old!, { kind: 'deleted' });

        expect((await afterReload())[0]?.problem).toBeNull();
    });

    test('a change saved before 3b, with the method as text, is brought up to date on load, as the migration does', async () => {
        const old = {
            recipeId: ID_A,
            kind: 'edit',
            etag: '"5"',
            createdAt: 1,
            savedAt: 1,
            problem: null,
            body: {
                ...body('Toast'),
                sections: undefined,
                instructions: '1. Toast it.\n\n2) Butter it.',
                ingredients: [{ ingredientId: 'b', ingredientName: 'bread', quantity: 2, quantityMax: null, unit: null, note: null }],
            },
            sent: [{ ...body('Toast'), sections: undefined, instructions: null, ingredients: [] }],
        };
        const storage = memoryStorage();
        await storage.setMany([['waitingChanges', [old]]]);
        setOfflineStorage(storage);

        const [change] = await afterReload();

        expect(change?.body).toEqual({
            ...body('Toast'),
            sections: [
                {
                    name: 'Method',
                    steps: [
                        { text: 'Toast it.', timerSeconds: null },
                        { text: 'Butter it.', timerSeconds: null },
                    ],
                },
            ],
            ingredients: [
                { ingredientId: 'b', ingredientName: 'bread', quantity: 2, quantityMax: null, unit: null, note: null, sectionIndex: null },
            ],
        });
        expect(change?.body).not.toHaveProperty('instructions');
        expect(change?.sent).toEqual([body('Toast')]);
    });

    test('a body already up to date is left as it is', () => {
        const current = { ...body('Toast'), sections: [{ name: 'Sauce', steps: [] }] };
        expect(upgradeBody(current)).toEqual(current);
    });

    test('can be discarded', async () => {
        await keepWaitingChange({ recipeId: ID_A, kind: 'create', body: body('Toast'), etag: null });
        await discardWaitingChange(ID_A);
        expect(await afterReload()).toEqual([]);
    });

    test("when storage refuses, nothing is shown as kept", async () => {
        await loadWaitingChanges();
        setOfflineStorage({ ...memoryStorage(), setMany: () => Promise.reject(new DOMException('Full', 'QuotaExceededError')) });

        await expect(
            keepWaitingChange({ recipeId: ID_A, kind: 'create', body: body('Toast'), etag: null }),
        ).rejects.toThrow('Full');

        expect(getWaitingState().changes).toEqual([]);
    });
});
