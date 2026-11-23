// The client builds against the same shared/ code as the API (F5). These only
// check the import works here; shared/ itself is tested in the API's Jest suite.
import { describe, expect, test } from 'vitest';
import { formatQuantity, parseQuantity } from '../../shared/quantity';
import { canonicaliseUnit } from '../../shared/units';

describe('shared code in the client', () => {
    test('formats and reads amounts', () => {
        expect(formatQuantity(1.5, null, 'tbsp')).toBe('1½');
        expect(parseQuantity('2-3')).toEqual({ quantity: 2, quantityMax: 3 });
    });

    test('knows the unit list', () => {
        expect(canonicaliseUnit('grams')).toBe('g');
    });
});
