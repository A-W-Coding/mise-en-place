/**
 * @module src/schemas/recipes
 * Request-body schemas for the Recipe endpoints (decision D1: Zod).
 *
 * Every schema is strict: an unknown field is a 400, so clients can't set
 * `id`, `createdAt` or anything else the server owns (S3). Parsing also
 * normalises: names are trimmed and units become canonical symbols.
 */

import { z } from 'zod';
import { canonicaliseUnit, UNIT_SYMBOLS } from '../units.js';

/** Message for a missing required field vs. one of the wrong type. */
const requiredOr = (wrongType: string) => (issue: { input: unknown }) =>
    issue.input === undefined ? 'Required.' : wrongType;

const recipeName = z
    .string({ error: requiredOr('Must be a string.') })
    .trim()
    .min(1, 'Must not be empty.')
    .max(200, 'Must be at most 200 characters.');

const text = z.string({ error: 'Must be a string or null.' }).nullable();

const servings = z
    .number({ error: 'Must be a number.' })
    .int('Must be a whole number.')
    .min(1, 'Must be at least 1.');

const minutes = z
    .number({ error: 'Must be a number or null.' })
    .int('Must be a whole number.')
    .min(0, 'Must be 0 or more.')
    .nullable();

/** A unit as typed, converted to its canonical symbol; null means a count. */
const unit = z
    .string({ error: 'Must be a string or null.' })
    .nullable()
    .optional()
    .transform((raw, ctx) => {
        const symbol = canonicaliseUnit(raw);
        if (symbol === undefined) {
            ctx.addIssue({
                code: 'custom',
                message: `Unknown unit "${raw}". Use one of: ${UNIT_SYMBOLS.join(', ')}, or none for a count.`,
            });
            return z.NEVER;
        }
        return symbol;
    });

/**
 * One ingredient line. Clients never send `orderIndex`: the server sets it
 * from the line's position in the array.
 */
export const ingredientLineSchema = z
    .strictObject({
        ingredientId: z.uuid({ error: requiredOr('Must be an ingredient id.') }),
        quantity: z.number({ error: 'Must be a number or null.' }).positive('Must be greater than 0.').nullable().optional(),
        quantityMax: z.number({ error: 'Must be a number or null.' }).nullable().optional(),
        unit,
        note: z.string({ error: 'Must be a string or null.' }).max(200, 'Must be at most 200 characters.').nullable().optional(),
    })
    .superRefine((line, ctx) => {
        if (line.quantityMax === null || line.quantityMax === undefined) return;
        if (line.quantity === null || line.quantity === undefined) {
            ctx.addIssue({ code: 'custom', path: ['quantityMax'], message: 'Only allowed when quantity is set.' });
        } else if (line.quantityMax < line.quantity) {
            ctx.addIssue({ code: 'custom', path: ['quantityMax'], message: 'Must be at least quantity.' });
        }
    });

const ingredientLines = z.array(ingredientLineSchema, { error: 'Must be an array of ingredient lines.' });

/** POST /api/recipes. Only `name` is required; `servings` defaults to 1. */
export const createRecipeSchema = z.strictObject({
    name: recipeName,
    description: text.optional(),
    servings: servings.default(1),
    prepTime: minutes.optional(),
    cookTime: minutes.optional(),
    instructions: text.optional(),
    ingredients: ingredientLines.optional(),
});

/**
 * PATCH /api/recipes/:id. Every field is optional, and only fields that are
 * present change. Written out rather than `createRecipeSchema.partial()`:
 * in Zod 4 a default still applies inside an optional field, so a PATCH
 * without `servings` would reset it to 1.
 */
export const updateRecipeSchema = z.strictObject({
    name: recipeName.optional(),
    description: text.optional(),
    servings: servings.optional(),
    prepTime: minutes.optional(),
    cookTime: minutes.optional(),
    instructions: text.optional(),
    ingredients: ingredientLines.optional(),
});

export type IngredientLine = z.output<typeof ingredientLineSchema>;
