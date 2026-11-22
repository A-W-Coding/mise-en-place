/**
 * @module tests/etag.test
 * Unit tests for `recipeEtag()` and `ifMatchDates()` (F3).
 */

import { recipeEtag, ifMatchDates } from '../src/utils/etag.js';

describe('recipeEtag', () => {
    test('quotes updatedAt in milliseconds, as a strong ETag', () => {
        expect(recipeEtag(new Date(1763836800123))).toBe('"1763836800123"');
    });
});

describe('ifMatchDates', () => {
    test('treats a missing header as "any version"', () => {
        expect(ifMatchDates(undefined)).toBeUndefined();
    });

    test.each(['*', ' * ', '"1", *'])('treats %p as "any version"', (header) => {
        expect(ifMatchDates(header)).toBeUndefined();
    });

    test.each([
        ['"1763836800123"', [1763836800123]],
        ['"1", "2"', [1, 2]],
        [' "5" ,"6"', [5, 6]],
    ])('reads %p', (header, expected) => {
        expect(ifMatchDates(header)?.map((date) => date.getTime())).toEqual(expected);
    });

    test.each(['W/"1763836800123"', '1763836800123', '"abc"', '', '"1'])(
        'skips %p, so nothing can match it',
        (header) => {
            expect(ifMatchDates(header)).toEqual([]);
        },
    );

    test('keeps the strong ETags in a list that also has a weak one', () => {
        expect(ifMatchDates('W/"1", "2"')?.map((date) => date.getTime())).toEqual([2]);
    });
});
