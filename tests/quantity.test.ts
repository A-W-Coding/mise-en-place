/**
 * @module tests/quantity.test
 * Unit tests for `formatQuantity()` and `parseQuantity()` (F5).
 */

import { formatQuantity, parseQuantity } from '../shared/quantity.js';

describe('formatQuantity', () => {
    test.each([
        // Fractions: spoons, cups, imperial and "other" units, and counts
        [0.5, null, 'tsp', '½'],
        [1.25, null, 'tbsp', '1¼'],
        [1.5, null, 'cup', '1½'],
        [0.125, null, 'tsp', '⅛'],
        [0.375, null, 'cup', '⅜'],
        [7.875, null, 'oz', '7⅞'],
        [0.5, null, 'can', '½'],
        [3, null, null, '3'],
        [1 / 3, null, 'cup', '⅓'],
        [2 / 3, null, 'cup', '⅔'],
        [0.33, null, 'cup', '⅓'],
        [0.66, null, null, '⅔'],
        // Close to a whole number
        [0.99, null, null, '1'],
        [2.01, null, 'tbsp', '2'],
        // Nowhere near a fraction: a decimal instead of a wrong fraction
        [0.3, null, 'cup', '0.3'],
        [2.45, null, 'tsp', '2.45'],
        // Metric units: decimals
        [250, null, 'g', '250'],
        [0.75, null, 'kg', '0.75'],
        [1.5, null, 'l', '1.5'],
        [0.333, null, 'ml', '0.33'],
        // Ranges
        [2, 3, null, '2–3'],
        [0.5, 1, 'tsp', '½–1'],
        [100, 150, 'g', '100–150'],
    ])('formatQuantity(%p, %p, %p) is %p', (quantity, quantityMax, unit, expected) => {
        expect(formatQuantity(quantity, quantityMax, unit)).toBe(expected);
    });

    test('shows nothing when there is no quantity ("to taste")', () => {
        expect(formatQuantity(null, null, null)).toBe('');
        expect(formatQuantity(null, null, 'pinch')).toBe('');
    });
});

describe('parseQuantity', () => {
    test.each([
        ['2', 2, null],
        ['1.5', 1.5, null],
        ['.5', 0.5, null],
        ['1/2', 0.5, null],
        ['3 / 4', 0.75, null],
        ['1 1/2', 1.5, null],
        ['½', 0.5, null],
        ['1½', 1.5, null],
        ['1 ½', 1.5, null],
        ['2-3', 2, 3],
        ['2 - 3', 2, 3],
        ['2–3', 2, 3],
        ['2—3', 2, 3],
        ['2 to 3', 2, 3],
        ['½-1', 0.5, 1],
        ['1 1/2-2', 1.5, 2],
        ['2-2', 2, 2],
        ['  4  ', 4, null],
    ])('reads %p', (text, quantity, quantityMax) => {
        expect(parseQuantity(text)).toEqual({ quantity, quantityMax });
    });

    test('reads a third exactly enough for formatQuantity to show it again', () => {
        const parsed = parseQuantity('1/3');
        expect(parsed).toEqual({ quantity: 1 / 3, quantityMax: null });
        expect(formatQuantity(1 / 3, null, 'cup')).toBe('⅓');
    });

    test.each(['', '   '])('reads %p as no quantity ("to taste")', (text) => {
        expect(parseQuantity(text)).toEqual({ quantity: null, quantityMax: null });
    });

    test.each(['abc', '1/0', '1 1/0', '1.5.2', '-2', '2-3-4', '1,5', 'two', '2 eggs', '½½'])(
        'refuses %p rather than guessing',
        (text) => {
            expect(parseQuantity(text)).toEqual({ error: expect.stringContaining("Couldn't read that amount") });
        },
    );

    test.each(['0', '0-2', '0.0'])('refuses %p, which is not more than 0', (text) => {
        expect(parseQuantity(text)).toEqual({ error: 'The amount must be more than 0.' });
    });

    test('refuses a range that runs backwards', () => {
        expect(parseQuantity('3-2')).toEqual({ error: 'In a range, the second amount must be at least the first.' });
    });
});
