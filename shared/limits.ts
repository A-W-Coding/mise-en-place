/**
 * @module shared/limits
 * What the API accepts in a recipe or an ingredient. The web client's editor
 * checks the same limits before saving (3c), so a change saved offline is
 * rarely refused once it uploads.
 *
 * The maxima keep servings and times well inside the database's 32-bit
 * integers. Beyond those, Postgres refuses the value, and the API could only
 * answer with a 500, which an upload would keep retrying.
 *
 * Plain data, with no server or browser imports, like `units.ts`.
 */

export const LIMITS = {
    /** Characters, after trimming. */
    recipeName: 200,
    /** Characters, after trimming; names are stored lowercase. */
    ingredientName: 100,
    /** Characters in a line's note. */
    note: 200,
    servings: { min: 1, max: 1000 },
    /** Prep and cook times, in whole minutes: up to about 69 days. */
    minutes: { min: 0, max: 99_999 },
} as const;
