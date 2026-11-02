/**
 * @module tests/schemas.test
 * Unit tests for the request schemas (D1: Zod): what each accepts, what
 * it rejects, and how it normalises (trimming, lowercase names, units,
 * defaults). The integration tests cover the same rules through HTTP.
 */

import { createRecipeSchema, updateRecipeSchema, ingredientLineSchema } from '../src/schemas/recipes.js';
import { ingredientBodySchema } from '../src/schemas/ingredients.js';
import { listQuerySchema } from '../src/schemas/list-query.js';

/** Any valid v4 UUID; these tests never look it up. */
const ID = '3f1c2b9e-8f0a-4d6e-9b7c-1a2b3c4d5e6f';

describe('createRecipeSchema', () => {
    test('trims the name and defaults servings to 1', () => {
        expect(createRecipeSchema.parse({ name: '  Soup  ' })).toEqual({ name: 'Soup', servings: 1 });
    });

    test('accepts null for the optional text and time fields', () => {
        const body = { name: 'Soup', description: null, instructions: null, prepTime: null, cookTime: 0 };
        expect(createRecipeSchema.parse(body)).toEqual({ ...body, servings: 1 });
    });

    test.each([
        ['no name', {}],
        ['an empty name', { name: '' }],
        ['a blank name', { name: '   ' }],
        ['a name over 200 characters', { name: 'x'.repeat(201) }],
        ['a name that is not a string', { name: 5 }],
        ['an unknown field', { name: 'Soup', id: ID }],
    ])('rejects %s', (_label, body) => {
        expect(createRecipeSchema.safeParse(body).success).toBe(false);
    });
});

describe('updateRecipeSchema', () => {
    test('adds no defaults, so an empty PATCH changes nothing', () => {
        expect(updateRecipeSchema.parse({})).toEqual({});
    });

    test.each([
        ['null servings', { servings: null }],
        ['an empty name', { name: '' }],
        ['an unknown field', { createdAt: '2020-01-01' }],
    ])('rejects %s', (_label, body) => {
        expect(updateRecipeSchema.safeParse(body).success).toBe(false);
    });
});

describe('ingredientLineSchema', () => {
    test('canonicalises the unit, and treats a missing unit as a count (null)', () => {
        expect(ingredientLineSchema.parse({ ingredientId: ID, quantity: 200, unit: 'Grams' })).toEqual({
            ingredientId: ID,
            quantity: 200,
            unit: 'g',
        });
        expect(ingredientLineSchema.parse({ ingredientId: ID, quantity: 3 }).unit).toBeNull();
    });

    test.each([
        ['a range', { quantity: 1, quantityMax: 2 }],
        ['a range with equal ends', { quantity: 2, quantityMax: 2 }],
        ['no quantity ("to taste")', { quantity: null, note: 'to taste' }],
    ])('accepts %s', (_label, line) => {
        expect(ingredientLineSchema.safeParse({ ingredientId: ID, ...line }).success).toBe(true);
    });

    test.each([
        ['quantityMax below quantity', { quantity: 3, quantityMax: 2 }, 'Must be at least quantity.'],
        ['quantityMax without quantity', { quantityMax: 2 }, 'Only allowed when quantity is set.'],
    ])('rejects %s on the quantityMax field', (_label, line, message) => {
        const result = ingredientLineSchema.safeParse({ ingredientId: ID, ...line });

        expect(result.error?.issues).toEqual([
            expect.objectContaining({ path: ['quantityMax'], message }),
        ]);
    });

    test.each([
        ['a quantity of 0', { quantity: 0 }],
        ['an unknown unit', { unit: 'handfull' }],
        ['an id that is not a UUID', { ingredientId: 'onion' }],
        ['a client-sent orderIndex', { orderIndex: 0 }],
    ])('rejects %s', (_label, line) => {
        expect(ingredientLineSchema.safeParse({ ingredientId: ID, ...line }).success).toBe(false);
    });
});

describe('ingredientBodySchema (name normalisation)', () => {
    test.each([
        ['  Onion  ', 'onion'],
        ['RED PEPPER', 'red pepper'],
        ['Crème Fraîche', 'crème fraîche'],
    ])('stores %j as %j', (name, stored) => {
        expect(ingredientBodySchema.parse({ name })).toEqual({ name: stored });
    });

    test('accepts exactly 100 characters', () => {
        expect(ingredientBodySchema.safeParse({ name: 'x'.repeat(100) }).success).toBe(true);
    });

    test.each(['', '   ', 'x'.repeat(101)])('rejects the name %j', (name) => {
        expect(ingredientBodySchema.safeParse({ name }).success).toBe(false);
    });
});

describe('listQuerySchema', () => {
    test('defaults to limit 50, offset 0 and no search', () => {
        expect(listQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    });

    test('turns limit and offset into numbers, and trims the search term', () => {
        expect(listQuerySchema.parse({ limit: '10', offset: '20', search: ' beef ' })).toEqual({
            limit: 10,
            offset: 20,
            search: 'beef',
        });
    });

    test('treats a blank search term as no search', () => {
        expect(listQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
    });

    test.each([
        ['limit over 100', { limit: '101' }],
        ['a negative limit', { limit: '-1' }],
        ['a fractional limit', { limit: '1.5' }],
        ['an empty limit', { limit: '' }],
        ['an offset past 2^53 − 1', { offset: String(2 ** 53) }],
        ['a repeated search', { search: ['a', 'b'] }],
        ['an unknown parameter', { page: '2' }],
    ])('rejects %s', (_label, query) => {
        expect(listQuerySchema.safeParse(query).success).toBe(false);
    });
});
