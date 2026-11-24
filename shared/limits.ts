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
    /** A method section's name, in characters after trimming (3b). */
    sectionName: 100,
    /** A step's text, in characters after trimming (3b). */
    stepText: 2000,
    /** A step's timer, in whole seconds: up to a day (3b). */
    timerSeconds: { min: 1, max: 86_400 },
    /** Characters in a tag's name, after trimming; stored lowercase (3b). */
    tagName: 50,
    /** Characters in an equipment item's name, after trimming; stored lowercase (3b). */
    equipmentName: 100,
    /** How many of an item an equipment line needs (3b). */
    equipmentQuantity: { min: 1, max: 99 },
} as const;

/** A tag's colour: `#rrggbb`, stored lowercase (3b). */
export const TAG_COLOUR = /^#[0-9a-f]{6}$/i;
