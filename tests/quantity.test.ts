/**
 * @module tests/quantity.test
 * Unit tests for `formatQuantity()`, `formatAmount()`, `parseQuantity()` and
 * `parseAmount()` (F5), and for timer lengths: `formatDuration()` and
 * `parseDuration()` (3b).
 */

import {
    formatAmount,
    formatDuration,
    formatQuantity,
    parseAmount,
    parseDuration,
    parseQuantity,
} from '../shared/quantity.js';

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

describe('formatAmount', () => {
    test.each([
        // Symbols never change
        [100, null, 'g', '100 g'],
        [1.5, null, 'l', '1.5 l'],
        [1, 2, 'tsp', '1–2 tsp'],
        [2, null, 'tbsp', '2 tbsp'],
        [2, null, 'fl oz', '2 fl oz'],
        // Word units are plural over 1, including the top of a range
        [1, null, 'clove', '1 clove'],
        [2, null, 'clove', '2 cloves'],
        [0.5, null, 'cup', '½ cup'],
        [1.5, null, 'cup', '1½ cups'],
        [1, 2, 'can', '1–2 cans'],
        [2, null, 'pinch', '2 pinches'],
        [3, null, 'bunch', '3 bunches'],
        [2, null, 'handful', '2 handfuls'],
        [2, null, 'slice', '2 slices'],
        // Counts have no unit, and "to taste" has no amount at all
        [3, null, null, '3'],
        [0.5, null, null, '½'],
        [2, 3, null, '2–3'],
        [null, null, null, ''],
        [null, null, 'pinch', ''],
    ])('formatAmount(%p, %p, %p) is %p', (quantity, quantityMax, unit, expected) => {
        expect(formatAmount(quantity, quantityMax, unit)).toBe(expected);
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

describe('parseAmount', () => {
    test.each([
        // Amount and unit, with or without a space
        ['100 g', 100, null, 'g'],
        ['100g', 100, null, 'g'],
        ['1.5 l', 1.5, null, 'l'],
        ['1½ tbsp', 1.5, null, 'tbsp'],
        ['1 1/2 tbsp', 1.5, null, 'tbsp'],
        ['½ cup', 0.5, null, 'cup'],
        ['1-2 tsp', 1, 2, 'tsp'],
        ['1–2 tsp', 1, 2, 'tsp'],
        ['2 to 3 cloves', 2, 3, 'clove'],
        ['10 fl oz', 10, null, 'fl oz'],
        // Any spelling the units list knows becomes its symbol
        ['250 grams', 250, null, 'g'],
        ['2 Tbsp.', 2, null, 'tbsp'],
        ['1 tin', 1, null, 'can'],
        ['3 pinches', 3, null, 'pinch'],
        // A count has no unit, and a blank box has no amount at all
        ['3', 3, null, null],
        ['2-3', 2, 3, null],
        ['½', 0.5, null, null],
        ['', null, null, null],
        ['   ', null, null, null],
    ])('reads "%s"', (text, quantity, quantityMax, unit) => {
        expect(parseAmount(text)).toEqual({ quantity, quantityMax, unit });
    });

    test.each([
        ['3 eggs', '“eggs” isn\'t a unit. For a count, type just the number.'],
        ['2 big', '“big” isn\'t a unit. For a count, type just the number.'],
        ['pinch', 'Put a number before “pinch”, like 1 pinch.'],
        ['grams', 'Put a number before “grams”, like 1 g.'],
        ['some', "Couldn't read that amount. Try 100 g, 1½ tbsp or 2-3."],
        ['1,5 kg', "Couldn't read that amount. Try 100 g, 1½ tbsp or 2-3."],
        ['1/0 clove', "Couldn't read that amount. Try 100 g, 1½ tbsp or 2-3."],
        ['0 g', 'The amount must be more than 0.'],
        ['3-2 tbsp', 'In a range, the second amount must be at least the first.'],
    ])('refuses "%s"', (text, error) => {
        expect(parseAmount(text)).toEqual({ error });
    });

    // The editor shows saved lines through formatAmount, so it must read them all back
    test.each([
        [1, null, null],
        [0.5, null, null],
        [1, null, 'clove'],
        [2, null, 'clove'],
        [1, 2, 'tsp'],
        [100, null, 'g'],
        [1.5, null, 'l'],
        [1.25, null, 'tbsp'],
        [1.5, null, 'cup'],
        [2, 3, 'can'],
        [2, null, 'fl oz'],
        [null, null, null],
    ])('reads back formatAmount(%p, %p, %p)', (quantity, quantityMax, unit) => {
        const shown = formatAmount(quantity, quantityMax, unit);
        expect(parseAmount(shown)).toEqual({ quantity, quantityMax, unit: quantity === null ? null : unit });
    });
});

describe('formatDuration', () => {
    test.each([
        [1200, '20 min'],
        [5400, '1 h 30 min'],
        [3600, '1 h'],
        [45, '45 s'],
        [90, '1 min 30 s'],
        [3725, '1 h 2 min 5 s'],
        [86_400, '24 h'],
    ])('shows %p seconds as %p', (seconds, expected) => {
        expect(formatDuration(seconds)).toBe(expected);
    });

    test('reads back through parseDuration', () => {
        for (const seconds of [1, 45, 90, 600, 1200, 3600, 3725, 5400, 86_400]) {
            expect(parseDuration(formatDuration(seconds))).toEqual({ seconds });
        }
    });
});

describe('parseDuration', () => {
    test.each([
        // A number on its own is minutes
        ['15', 900],
        ['1.5', 90],
        [' 20 ', 1200],
        // Units, in any of their spellings
        ['90 s', 90],
        ['90s', 90],
        ['45 sec', 45],
        ['30 seconds', 30],
        ['15 min', 900],
        ['15m', 900],
        ['1 minute', 60],
        ['10 MINS', 600],
        ['1 h', 3600],
        ['2 hrs', 7200],
        ['1.5 hours', 5400],
        ['.5 h', 1800],
        // Several, largest first
        ['1 h 30 min', 5400],
        ['1h30m', 5400],
        ['1 hour, 30 minutes', 5400],
        ['2 hours and 15 minutes', 8100],
        ['1 min 30 s', 90],
        // A last number with no unit takes the next smaller one
        ['1 h 30', 5400],
        ['1h30', 5400],
        ['2 min 15', 135],
        // Rounded to whole seconds
        ['0.01 min', 1],
        // The limits: a second to a day
        ['1 s', 1],
        ['24 h', 86_400],
    ])('reads %p as %p seconds', (text, seconds) => {
        expect(parseDuration(text)).toEqual({ seconds });
    });

    test.each(['1:30', 'abc', 'min', '15 minutes.', '30 s 5', '1 min 2 h', '1 h 2 h', '15 eggs', '-5', '1/2 h', '15 min 30 s 2'])(
        "refuses %p, which it can't read without guessing",
        (text) => {
            expect(parseDuration(text)).toEqual({ error: "Couldn't read that. Try 90 s, 15 min or 1 h 30 min." });
        },
    );

    test.each(['', '   '])('asks for a length when given %p', (text) => {
        expect(parseDuration(text)).toEqual({ error: 'Type how long, like 15 min.' });
    });

    test.each(['0', '0 s', '0.001 min'])('refuses %p, under a second', (text) => {
        expect(parseDuration(text)).toEqual({ error: 'A timer needs to be at least 1 second.' });
    });

    test.each(['25 h', '1441', '24 h 1 s'])('refuses %p, over a day', (text) => {
        expect(parseDuration(text)).toEqual({ error: 'Keep a timer to a day (24 h) or less.' });
    });
});
