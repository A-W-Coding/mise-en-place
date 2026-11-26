/**
 * @module src/schemas/tags
 * Request-body schemas for the Tag endpoints (3b; decision D1: Zod).
 *
 * A tag's name is normalised like an ingredient's (trimmed, lowercase), so
 * "Beef" and "beef" are one tag. Its colour is `#rrggbb`, stored lowercase,
 * or null for none. Strict, like every body schema: an unknown field is a 400.
 */

import { z } from 'zod';
import { LIMITS, TAG_COLOUR } from '../../shared/limits.js';

const name = z
    .string({ error: (issue) => (issue.input === undefined ? 'Required.' : 'Must be a string.') })
    .trim()
    .toLowerCase()
    .min(1, 'Must not be empty.')
    .max(LIMITS.tagName, `Must be at most ${LIMITS.tagName} characters.`);

const color = z
    .string({ error: 'Must be a colour like #1f7a5c, or null.' })
    .regex(TAG_COLOUR, 'Must be a colour like #1f7a5c, or null.')
    .transform((value) => value.toLowerCase())
    .nullable();

/** POST /api/tags: a name, and a colour if it has one. */
export const createTagSchema = z.strictObject({
    name,
    color: color.optional(),
});

/** PATCH /api/tags/:id: a new name, a new colour, or both. Only what's sent changes. */
export const updateTagSchema = z.strictObject({
    name: name.optional(),
    color: color.optional(),
});
