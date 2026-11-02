/**
 * @module tests/units.test
 * Unit tests for the canonical unit list and `canonicaliseUnit()` (D2).
 */

import { canonicaliseUnit, UNITS, UNIT_SYMBOLS } from '../src/units.js';

describe('canonicaliseUnit', () => {
    test.each(UNIT_SYMBOLS)('maps the symbol %j to itself', (symbol) => {
        expect(canonicaliseUnit(symbol)).toBe(symbol);
    });

    test.each([
        ['grams', 'g'],
        ['GRAMS', 'g'],
        ['  gram  ', 'g'],
        ['tbsp.', 'tbsp'],
        [' Tbsp. ', 'tbsp'],
        ['tablespoons', 'tbsp'],
        ['tin', 'can'],
        ['Fluid  Ounces', 'fl oz'],
        ['FL OZ', 'fl oz'],
        ['lbs', 'lb'],
        ['millilitres', 'ml'],
    ])('maps the alias %j to %j', (input, symbol) => {
        expect(canonicaliseUnit(input)).toBe(symbol);
    });

    test.each([null, undefined, '', '   '])('treats %j as no unit (a count)', (input) => {
        expect(canonicaliseUnit(input)).toBeNull();
    });

    test.each(['handfull', 'whole', 'g g', 'tbsp..'])('returns undefined for the unknown unit %j', (input) => {
        expect(canonicaliseUnit(input)).toBeUndefined();
    });
});

describe('UNITS', () => {
    const spellingsOf = (symbol: keyof typeof UNITS): string[] => [symbol, ...UNITS[symbol].aliases];

    test("has no spelling that means two units, or an alias that is another unit's symbol", () => {
        const spellings = UNIT_SYMBOLS.flatMap(spellingsOf);
        expect(new Set(spellings).size).toBe(spellings.length);
    });

    test('writes every spelling in the form canonicaliseUnit() looks up', () => {
        for (const spelling of UNIT_SYMBOLS.flatMap(spellingsOf)) {
            expect(spelling).toBe(spelling.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, ''));
        }
    });
});
