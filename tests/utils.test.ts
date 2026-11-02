/**
 * @module tests/utils.test
 * Unit tests for the small helpers: `isPrismaError()`, `escapeLikePattern()`
 * and `fieldMessages()`.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isPrismaError } from '../src/utils/prisma-errors.js';
import { escapeLikePattern } from '../src/utils/fuzzy-search.js';
import { fieldMessages } from '../src/utils/validation.js';

describe('isPrismaError', () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.6.0',
    });

    test('matches a Prisma error with the same code, and only that code', () => {
        expect(isPrismaError(uniqueViolation, 'P2002')).toBe(true);
        expect(isPrismaError(uniqueViolation, 'P2025')).toBe(false);
    });

    test.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'P2002'],
        ['a plain Error', new Error('P2002')],
        ['an object with a numeric code', { code: 2002 }],
    ])('returns false for %s', (_label, value) => {
        expect(isPrismaError(value, 'P2002')).toBe(false);
    });
});

describe('escapeLikePattern', () => {
    test.each([
        ['plain', 'plain'],
        ['100%', '100\\%'],
        ['a_b', 'a\\_b'],
        ['back\\slash', 'back\\\\slash'],
        ['%_\\', '\\%\\_\\\\'],
    ])('escapes %j as %j', (input, escaped) => {
        expect(escapeLikePattern(input)).toBe(escaped);
    });
});

describe('fieldMessages', () => {
    const schema = z.strictObject({
        name: z.string().min(5, 'Too short.').regex(/^[a-z]+$/, 'Lowercase only.'),
        lines: z.array(z.strictObject({ qty: z.number() })),
    });

    /** The error from parsing `value`, which must be invalid. */
    function errorFor(value: unknown): z.ZodError {
        const result = schema.safeParse(value);
        if (result.success) throw new Error('expected the value to be invalid');
        return result.error;
    }

    test('gives one message per field, with dotted paths for nested and unknown fields', () => {
        const fields = fieldMessages(errorFor({ name: 'abcdef', lines: [{ qty: 'x', extra: 1 }], id: 1 }));

        expect(Object.keys(fields).sort()).toEqual(['id', 'lines.0.extra', 'lines.0.qty']);
        expect(fields.id).toBe('Unknown field.');
        expect(fields['lines.0.extra']).toBe('Unknown field.');
    });

    test('keeps only the first message when a field fails twice', () => {
        expect(fieldMessages(errorFor({ name: 'AB', lines: [] }))).toEqual({ name: 'Too short.' });
    });

    test('uses "(input)" when the input as a whole is wrong', () => {
        expect(Object.keys(fieldMessages(errorFor('not an object')))).toEqual(['(input)']);
    });
});
