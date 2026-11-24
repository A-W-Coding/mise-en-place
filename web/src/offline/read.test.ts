import { describe, expect, test } from 'vitest';
import { beefChili, etagOf, lemonDrizzle, snapshotOf } from '../test/fixtures';
import type { OfflineCopy } from './copy';
import { listFromCopy, matchesSearch, recipeFromCopy, servedFromCopy } from './read';

const copy: OfflineCopy = {
    data: snapshotOf([lemonDrizzle, beefChili]),
    etag: '"snapshot-1"',
    fetchedAt: 0,
    checkedAt: 0,
};

describe('matchesSearch', () => {
    test.each([
        ['Beef Chili', 'chili', true],
        ['Beef Chili', 'CHI', true],
        ['Beef Chili', 'chili beef', true],
        ['Beef Chili', 'beef stew', false],
        ['Crème brûlée', 'creme brulee', true],
        ['Creme brulee', 'crème', true],
        ['Beef Chili', '   ', true],
    ])('%s matches %j: %s', (name, search, expected) => {
        expect(matchesSearch(name, search)).toBe(expected);
    });
});

describe('listFromCopy', () => {
    const names = Array.from({ length: 25 }, (_, n) => ({ name: `Recipe ${String(n + 1).padStart(2, '0')}` }));

    test('pages through the list as the API would, with its total', () => {
        expect(listFromCopy(names, '', 0, 20)).toMatchObject({ totalCount: 25, fromCopy: true, etag: null });
        expect(listFromCopy(names, '', 0, 20).data).toHaveLength(20);
        expect(listFromCopy(names, '', 20, 20).data.map((item) => item.name)).toEqual([
            'Recipe 21',
            'Recipe 22',
            'Recipe 23',
            'Recipe 24',
            'Recipe 25',
        ]);
    });

    test('searches on the device, and counts the matches', () => {
        const result = listFromCopy(copy.data.recipes, 'cake', 0, 20);
        expect(result.data.map((recipe) => recipe.name)).toEqual(['Lemon Drizzle Cake']);
        expect(result.totalCount).toBe(1);
        expect(listFromCopy(copy.data.recipes, 'risotto', 0, 20)).toMatchObject({ data: [], totalCount: 0 });
    });
});

describe('recipeFromCopy', () => {
    test('finds a recipe by id, with the ETag the snapshot gave it', () => {
        expect(recipeFromCopy(copy, beefChili.id)).toEqual({
            data: beefChili,
            etag: etagOf(beefChili),
            totalCount: null,
            fromCopy: true,
        });
    });

    test("returns null for a recipe the copy hasn't got", () => {
        expect(recipeFromCopy(copy, '99999999-0000-4000-8000-000000000000')).toBeNull();
    });
});

describe('servedFromCopy', () => {
    test('spots an answer from the copy, alone or as any page of a list', () => {
        const fromCopy = recipeFromCopy(copy, beefChili.id);
        const fromApi = { data: beefChili, etag: '"1"', totalCount: null };
        expect(servedFromCopy(fromCopy)).toBe(true);
        expect(servedFromCopy(fromApi)).toBe(false);
        expect(servedFromCopy({ pages: [fromApi, fromCopy], pageParams: [0, 20] })).toBe(true);
        expect(servedFromCopy({ pages: [fromApi], pageParams: [0] })).toBe(false);
        expect(servedFromCopy(undefined)).toBe(false);
    });
});
