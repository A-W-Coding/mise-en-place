/**
 * @module src/schemas/ingredients
 * Request-body schema for the Ingredient endpoints (decision D1: Zod).
 *
 * Strict, like every body schema: an unknown field is a 400 (S3).
 */

import { z } from 'zod';

/** POST and PATCH /api/ingredients. The name is stored trimmed and lowercase. */
export const ingredientBodySchema = z.strictObject({
    name: z
        .string({ error: (issue) => (issue.input === undefined ? 'Required.' : 'Must be a string.') })
        .trim()
        .toLowerCase()
        .min(1, 'Must not be empty.')
        .max(100, 'Must be at most 100 characters.'),
});
