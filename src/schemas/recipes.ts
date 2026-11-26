/**
 * @module src/schemas/recipes
 * Request-body schemas for the Recipe endpoints (decision D1: Zod).
 *
 * Every schema is strict: an unknown field is a 400, so clients can't set
 * `createdAt` or anything else the server owns (S3). The one exception is a
 * new recipe's `id`, which the client may choose (3c, D15); nothing can
 * change an existing one. Parsing also normalises: names are trimmed and
 * units become canonical symbols.
 *
 * Lengths and number ranges come from `shared/limits.ts`, which the web
 * client's editor checks too.
 *
 * From 3b the method is `sections`, each with its `steps`, and an ingredient
 * line can sit in a section (`sectionIndex`). Phase 1's `instructions` is no
 * longer accepted: a migration moved it into steps (spec §7.2). A recipe's
 * tags are `tagIds`, in order, and its equipment lines `equipment`.
 */

import { z } from 'zod';
import { LIMITS } from '../../shared/limits.js';
import { canonicaliseUnit, UNIT_SYMBOLS } from '../../shared/units.js';

/** Message for a missing required field vs. one of the wrong type. */
const requiredOr = (wrongType: string) => (issue: { input: unknown }) =>
    issue.input === undefined ? 'Required.' : wrongType;

const recipeName = z
    .string({ error: requiredOr('Must be a string.') })
    .trim()
    .min(1, 'Must not be empty.')
    .max(LIMITS.recipeName, `Must be at most ${LIMITS.recipeName} characters.`);

const text = z.string({ error: 'Must be a string or null.' }).nullable();

/** A method section's name: "Sauce", "Base" (3b). */
const sectionName = z
    .string({ error: requiredOr('Must be a string.') })
    .trim()
    .min(1, 'Must not be empty.')
    .max(LIMITS.sectionName, `Must be at most ${LIMITS.sectionName} characters.`);

/** One step of a section's method, with an optional timer cooking mode can start (3b). */
export const stepSchema = z.strictObject({
    text: z
        .string({ error: requiredOr('Must be a string.') })
        .trim()
        .min(1, 'Must not be empty.')
        .max(LIMITS.stepText, `Must be at most ${LIMITS.stepText} characters.`),
    timerSeconds: z
        .number({ error: 'Must be a number or null.' })
        .int('Must be a whole number.')
        .min(LIMITS.timerSeconds.min, `Must be at least ${LIMITS.timerSeconds.min}.`)
        .max(LIMITS.timerSeconds.max, `Must be at most ${LIMITS.timerSeconds.max}.`)
        .nullable()
        .optional(),
});

/** One section of the method, with its steps in order. A section with no steps can still group ingredient lines. */
export const sectionSchema = z.strictObject({
    name: sectionName,
    steps: z.array(stepSchema, { error: requiredOr('Must be an array of steps.') }),
});

const sections = z.array(sectionSchema, { error: 'Must be an array of sections.' });

/**
 * The recipe's tags, in its own order: the list shows the first two (3b).
 * Each tag once, since a tag can't be on a recipe twice.
 */
const tagIds = z
    .array(z.uuid({ error: 'Must be a tag id.' }).transform((id) => id.toLowerCase()), {
        error: 'Must be an array of tag ids.',
    })
    .superRefine((ids, ctx) => {
        ids.forEach((id, index) => {
            if (ids.indexOf(id) !== index) ctx.addIssue({ code: 'custom', path: [index], message: 'Each tag only once.' });
        });
    });

/** One equipment line: which item, how many, and whether the recipe works without it (3b). */
export const equipmentLineSchema = z.strictObject({
    equipmentId: z.uuid({ error: requiredOr('Must be an equipment id.') }),
    quantity: z
        .number({ error: 'Must be a number.' })
        .int('Must be a whole number.')
        .min(LIMITS.equipmentQuantity.min, `Must be at least ${LIMITS.equipmentQuantity.min}.`)
        .max(LIMITS.equipmentQuantity.max, `Must be at most ${LIMITS.equipmentQuantity.max}.`)
        .default(1),
    optional: z.boolean({ error: 'Must be true or false.' }).default(false),
});

const equipmentLines = z.array(equipmentLineSchema, { error: 'Must be an array of equipment lines.' });

const servings = z
    .number({ error: 'Must be a number.' })
    .int('Must be a whole number.')
    .min(LIMITS.servings.min, `Must be at least ${LIMITS.servings.min}.`)
    .max(LIMITS.servings.max, `Must be at most ${LIMITS.servings.max}.`);

const minutes = z
    .number({ error: 'Must be a number or null.' })
    .int('Must be a whole number.')
    .min(LIMITS.minutes.min, `Must be ${LIMITS.minutes.min} or more.`)
    .max(LIMITS.minutes.max, `Must be at most ${LIMITS.minutes.max}.`)
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
        note: z
            .string({ error: 'Must be a string or null.' })
            .max(LIMITS.note, `Must be at most ${LIMITS.note} characters.`)
            .nullable()
            .optional(),
        /** The section, by its position in the body's `sections`, or none (3b). */
        sectionIndex: z
            .number({ error: 'Must be a number or null.' })
            .int('Must be a whole number.')
            .min(0, 'Must be 0 or more.')
            .nullable()
            .optional(),
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

/**
 * A new recipe's id, chosen by the client (3c, D15). Lowercased, because ids
 * are stored and compared as text, and the server's own are lowercase.
 */
const newRecipeId = z.uuid({ error: 'Must be a UUID.' }).transform((id) => id.toLowerCase());

interface SectionsAndLines {
    sections?: unknown[];
    ingredients?: { sectionIndex?: number | null }[];
}

/**
 * The rules that span `sections` and `ingredients` (spec §3.2): a line's
 * `sectionIndex` must point inside this body's `sections`, and a body with
 * `sections` must have `ingredients` too, because replacing the sections
 * gives them new ids, and lines would otherwise lose their section unseen.
 */
function checkSections(body: SectionsAndLines, ctx: z.RefinementCtx): void {
    if (body.sections !== undefined && body.ingredients === undefined) {
        ctx.addIssue({ code: 'custom', path: ['ingredients'], message: 'Required with sections, so lines keep their sections.' });
    }
    const count = body.sections?.length ?? 0;
    body.ingredients?.forEach((line, index) => {
        if (line.sectionIndex === null || line.sectionIndex === undefined || line.sectionIndex < count) return;
        ctx.addIssue({
            code: 'custom',
            path: ['ingredients', index, 'sectionIndex'],
            message:
                body.sections === undefined
                    ? 'Only allowed with sections.'
                    : `Must point to one of the ${count} section${count === 1 ? '' : 's'}.`,
        });
    });
}

/** POST /api/recipes. Only `name` is required; `servings` defaults to 1. */
export const createRecipeSchema = z
    .strictObject({
        id: newRecipeId.optional(),
        name: recipeName,
        description: text.optional(),
        servings: servings.default(1),
        prepTime: minutes.optional(),
        cookTime: minutes.optional(),
        sections: sections.optional(),
        ingredients: ingredientLines.optional(),
        tagIds: tagIds.optional(),
        equipment: equipmentLines.optional(),
    })
    .superRefine(checkSections);

/**
 * PATCH /api/recipes/:id. Every field is optional, and only fields that are
 * present change. Written out rather than `createRecipeSchema.partial()`:
 * in Zod 4 a default still applies inside an optional field, so a PATCH
 * without `servings` would reset it to 1.
 */
export const updateRecipeSchema = z
    .strictObject({
        name: recipeName.optional(),
        description: text.optional(),
        servings: servings.optional(),
        prepTime: minutes.optional(),
        cookTime: minutes.optional(),
        sections: sections.optional(),
        ingredients: ingredientLines.optional(),
        tagIds: tagIds.optional(),
        equipment: equipmentLines.optional(),
    })
    .superRefine(checkSections);

export type IngredientLine = z.output<typeof ingredientLineSchema>;
export type Section = z.output<typeof sectionSchema>;
export type EquipmentLine = z.output<typeof equipmentLineSchema>;
