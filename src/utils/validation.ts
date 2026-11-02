/**
 * @module src/utils/validation
 * Shared request validation helpers.
 *
 * Routes parse their input with a Zod schema (from `src/schemas/`) through
 * `parseOr400()`, so every validation failure has the same response shape:
 *
 *     400 { "error": "Validation failed.", "fields": { "<path>": "<message>" } }
 *
 * `fields` has one message per failing field. Nested paths are dotted, as
 * in `ingredients.0.unit`; a problem with the input as a whole is `(input)`.
 */

import { Response } from 'express';
import { z } from 'zod';

/**
 * Turn a Zod error into one message per field.
 * Unknown fields (from strict schemas) each get "Unknown field.".
 *
 * @param error - The error from a failed `safeParse`.
 * @returns A map from field path to its first message.
 */
export function fieldMessages(error: z.ZodError): Record<string, string> {
    const fields: Record<string, string> = {};
    const add = (path: PropertyKey[], message: string) => {
        const key = path.map(String).join('.') || '(input)';
        fields[key] ??= message;
    };

    for (const issue of error.issues) {
        if (issue.code === 'unrecognized_keys') {
            for (const key of issue.keys) add([...issue.path, key], 'Unknown field.');
        } else {
            add(issue.path, issue.message);
        }
    }
    return fields;
}

/**
 * Parse a value with a Zod schema.
 *
 * If validation fails, sends a 400 JSON response on the provided `res`
 * object and returns `null`. On success, returns the parsed data, with the
 * schema's normalisation (trimming, unit symbols, defaults) applied.
 *
 * @param schema - The Zod schema for this input.
 * @param value  - The raw value, such as `req.body` or `req.query`.
 * @param res    - Express response object (used only on failure).
 * @returns The parsed data, or `null` if validation failed (response already sent).
 *
 * @example
 * const body = parseOr400(createRecipeSchema, req.body, res);
 * if (body === null) return;          // 400 already sent
 * // ... use `body` safely
 */
export function parseOr400<S extends z.ZodType>(
    schema: S,
    value: unknown,
    res: Response,
): z.output<S> | null {
    const result = schema.safeParse(value);
    if (!result.success) {
        res.status(400).json({ error: 'Validation failed.', fields: fieldMessages(result.error) });
        return null;
    }
    return result.data;
}
