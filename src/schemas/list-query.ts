/**
 * @module src/schemas/list-query
 * Query-string schema for the list endpoints (GET /api/recipes and
 * GET /api/ingredients).
 *
 * Express 5 turns a repeated parameter into an array (`?search=a&search=b`
 * gives `['a', 'b']`), so every parameter is checked to be a single string.
 * The schema is strict like the body schemas: a misspelt `?serach=` is a
 * 400 rather than a silently unfiltered list.
 */

import { z } from 'zod';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/**
 * A whole number of 0 or more, written as digits only ("0", "50").
 * Capped at the largest integer JavaScript represents exactly.
 */
const wholeNumber = z
    .string({ error: 'Must be a single whole number.' })
    .regex(/^\d+$/, 'Must be a whole number, 0 or more.')
    .transform(Number)
    .pipe(z.number().max(Number.MAX_SAFE_INTEGER, 'Too large.'));

export const listQuerySchema = z.strictObject({
    /** Fuzzy search term: trimmed, at most 100 characters; empty means no search. */
    search: z
        .string({ error: 'Must be a single string.' })
        .trim()
        .max(100, 'Must be at most 100 characters.')
        .optional()
        .transform((term) => term || undefined),

    /** Page size: 0–100, default 50. */
    limit: wholeNumber
        .pipe(z.number().max(MAX_LIMIT, `Must be at most ${MAX_LIMIT}.`))
        .default(DEFAULT_LIMIT),

    /** How many items to skip: default 0. */
    offset: wholeNumber.default(0),
});

export type ListQuery = z.output<typeof listQuerySchema>;

/** The part of a list query that selects a page. */
export type Page = Pick<ListQuery, 'limit' | 'offset'>;
