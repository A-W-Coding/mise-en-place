import { afterEach, describe, expect, test, vi } from 'vitest';
import { beefChili, DAY_MS, lemonDrizzle, seedCopy, snapshotOf } from '../test/fixtures';
import {
    confirmOfflineCopy,
    getOfflineCopyState,
    isSnapshot,
    loadOfflineCopy,
    putRecipeInCopy,
    replaceOfflineCopy,
    resetOfflineCopy,
} from './copy';
import { memoryStorage, setOfflineStorage, type OfflineStorage } from './storage';

afterEach(() => {
    vi.useRealTimers();
});

/** Read the copy again from storage, as a fresh start of the app would. */
async function reloadFromStorage() {
    resetOfflineCopy();
    return loadOfflineCopy();
}

describe('the offline copy', () => {
    test('starts empty', async () => {
        expect(getOfflineCopyState()).toEqual({ status: 'loading', copy: null });
        expect(await loadOfflineCopy()).toBeNull();
        expect(getOfflineCopyState()).toEqual({ status: 'ready', copy: null });
    });

    test('keeps a snapshot with its ETag and when it arrived, through a fresh start', async () => {
        vi.useFakeTimers({ now: new Date('2026-11-24T09:00:00Z') });
        await replaceOfflineCopy(snapshotOf([beefChili]), '"snapshot-1"');

        const copy = await reloadFromStorage();

        expect(copy).toEqual({
            data: snapshotOf([beefChili]),
            etag: '"snapshot-1"',
            fetchedAt: Date.parse('2026-11-24T09:00:00Z'),
            checkedAt: Date.parse('2026-11-24T09:00:00Z'),
        });
    });

    test('never expires: a copy fetched 60 days ago is still there', async () => {
        vi.useFakeTimers({ now: new Date('2026-09-25T09:00:00Z') });
        await seedCopy([beefChili]);

        vi.setSystemTime(new Date('2026-09-25T09:00:00Z').getTime() + 60 * DAY_MS);
        const copy = await reloadFromStorage();

        expect(copy?.data.recipes.map((recipe) => recipe.name)).toEqual(['Beef Chili']);
        expect(Date.now() - (copy?.fetchedAt ?? 0)).toBe(60 * DAY_MS);
    });

    test('a newer snapshot replaces the old one whole', async () => {
        await seedCopy([beefChili], DAY_MS, '"snapshot-1"');
        await replaceOfflineCopy(snapshotOf([lemonDrizzle]), '"snapshot-2"');

        const copy = await reloadFromStorage();

        expect(copy?.etag).toBe('"snapshot-2"');
        expect(copy?.data.recipes.map((recipe) => recipe.name)).toEqual(['Lemon Drizzle Cake']);
        expect(copy?.data.ingredients).toEqual([]);
    });

    test('a page asking after a refresh gets the new copy, not what the first read found', async () => {
        expect(await loadOfflineCopy()).toBeNull();

        await replaceOfflineCopy(snapshotOf([beefChili]), '"snapshot-1"');

        expect((await loadOfflineCopy())?.etag).toBe('"snapshot-1"');
    });

    test('confirming it current moves only checkedAt', async () => {
        vi.useFakeTimers({ now: new Date('2026-11-20T09:00:00Z') });
        await seedCopy([beefChili]);
        const before = getOfflineCopyState().copy;

        vi.setSystemTime(new Date('2026-11-24T09:00:00Z'));
        await confirmOfflineCopy();
        const copy = await reloadFromStorage();

        expect(copy).toEqual({ ...before, checkedAt: Date.parse('2026-11-24T09:00:00Z') });
        expect(copy?.fetchedAt).toBe(Date.parse('2026-11-20T09:00:00Z'));
    });

    test('notifies its listeners only once the new snapshot is stored', async () => {
        let release = () => {};
        const slow = memoryStorage();
        setOfflineStorage({
            ...slow,
            setMany: (entries) =>
                new Promise<void>((resolve) => {
                    release = () => void slow.setMany(entries).then(resolve);
                }),
        });
        await loadOfflineCopy();

        const replacing = replaceOfflineCopy(snapshotOf([beefChili]), '"snapshot-1"');
        await Promise.resolve();
        expect(getOfflineCopyState().copy).toBeNull();

        release();
        await replacing;
        expect(getOfflineCopyState().copy?.etag).toBe('"snapshot-1"');
    });

    test("with storage that can't be read, there's simply no copy", async () => {
        const broken: OfflineStorage = {
            getMany: () => Promise.reject(new Error('IndexedDB is unavailable')),
            setMany: () => Promise.reject(new Error('IndexedDB is unavailable')),
        };
        setOfflineStorage(broken);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await loadOfflineCopy()).toBeNull();
        expect(getOfflineCopyState()).toEqual({ status: 'ready', copy: null });
        expect(warn).toHaveBeenCalled();
    });

    test('ignores a stored record that is not a snapshot', async () => {
        const storage = memoryStorage();
        await storage.setMany([['snapshot', { data: { recipes: 'nope' }, etag: null, fetchedAt: 1 }]]);
        setOfflineStorage(storage);

        expect(await loadOfflineCopy()).toBeNull();
    });
});

describe('putRecipeInCopy', () => {
    test('puts a recipe the API sent back into the copy, in name order, with its ETag and any new ingredient', async () => {
        await seedCopy([beefChili], DAY_MS, '"snapshot-1"');
        const sourdough = { id: 'ing-sourdough', name: 'sourdough', createdAt: beefChili.createdAt, updatedAt: beefChili.updatedAt };
        const toast = {
            ...lemonDrizzle,
            id: 'aaaaaaaa-0000-4000-8000-000000000009',
            name: 'Avocado Toast',
            recipeIngredients: [{ ...beefChili.recipeIngredients[0]!, ingredientId: sourdough.id, ingredient: sourdough }],
        };

        await putRecipeInCopy(toast, '"77"');
        const copy = await reloadFromStorage();

        expect(copy?.data.recipes.map((recipe) => recipe.name)).toEqual(['Avocado Toast', 'Beef Chili']);
        expect(copy?.data.etags[toast.id]).toBe('"77"');
        expect(copy?.data.ingredients.map((ingredient) => ingredient.name)).toContain('sourdough');
        // Still the old snapshot's ETag, so the next refresh fetches it all
        expect(copy?.etag).toBe('"snapshot-1"');
    });

    test('replaces a recipe already there', async () => {
        await seedCopy([beefChili, lemonDrizzle]);

        await putRecipeInCopy({ ...beefChili, description: 'Hotter.' }, '"78"');

        const copy = await reloadFromStorage();
        expect(copy?.data.recipes.map((recipe) => [recipe.name, recipe.description])).toEqual([
            ['Beef Chili', 'Hotter.'],
            ['Lemon Drizzle Cake', null],
        ]);
    });
});

describe('isSnapshot', () => {
    test("accepts the API's shape, and nothing else", () => {
        expect(isSnapshot(snapshotOf([beefChili]))).toBe(true);
        expect(isSnapshot({ recipes: [], ingredients: [], etags: {}, tags: [], equipment: [] })).toBe(true);
        expect(isSnapshot(null)).toBe(false);
        expect(isSnapshot({ recipes: [], etags: {} })).toBe(false);
        // A copy from before Step 17, with no ETags, is fetched again whole
        expect(isSnapshot({ recipes: [], ingredients: [] })).toBe(false);
        expect(isSnapshot({ recipes: [], ingredients: [], etags: { a: 1 } })).toBe(false);
        expect(isSnapshot({ recipes: [{ id: 'a', name: 'A' }], ingredients: [], etags: {} })).toBe(false);
        // A copy from before 3b, with the method as text, is fetched again whole rather than shown broken
        expect(isSnapshot({ recipes: [{ id: 'a', name: 'A', recipeIngredients: [], instructions: 'Stir.' }], ingredients: [], etags: {} })).toBe(
            false,
        );
        expect(isSnapshot({ recipes: [], ingredients: [{ id: 1, name: 'salt' }], etags: {}, tags: [], equipment: [] })).toBe(false);
        // A copy from before Step 23, with no tags or equipment, is fetched again too
        expect(isSnapshot({ recipes: [], ingredients: [], etags: {} })).toBe(false);
        const untagged = { ...beefChili, tags: undefined };
        expect(isSnapshot({ recipes: [untagged], ingredients: [], etags: {}, tags: [], equipment: [] })).toBe(false);
        expect(isSnapshot({ recipes: [], ingredients: [], etags: {}, tags: [{ id: 'a' }], equipment: [] })).toBe(false);
    });
});
