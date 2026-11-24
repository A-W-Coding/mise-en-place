/**
 * @module src/schemas/equipment
 * Request-body schema for the Equipment endpoints (3b; decision D1: Zod).
 *
 * Names are normalised like ingredients' (trimmed, lowercase), and strict
 * like every body schema: an unknown field is a 400.
 */

import { z } from 'zod';
import { LIMITS } from '../../shared/limits.js';

/** POST and PATCH /api/equipment. The name is stored trimmed and lowercase. */
export const equipmentBodySchema = z.strictObject({
    name: z
        .string({ error: (issue) => (issue.input === undefined ? 'Required.' : 'Must be a string.') })
        .trim()
        .toLowerCase()
        .min(1, 'Must not be empty.')
        .max(LIMITS.equipmentName, `Must be at most ${LIMITS.equipmentName} characters.`),
});
