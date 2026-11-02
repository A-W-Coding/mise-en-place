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

export const listQuerySchema = z.strictObject({
    /** Fuzzy search term: trimmed, at most 100 characters; empty means no search. */
    search: z
        .string({ error: 'Must be a single string.' })
        .trim()
        .max(100, 'Must be at most 100 characters.')
        .optional()
        .transform((term) => term || undefined),
});

export type ListQuery = z.output<typeof listQuerySchema>;
