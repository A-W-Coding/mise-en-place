/**
 * @module shared/quantity
 * Showing and reading ingredient amounts (F5).
 *
 * The API stores amounts as numbers: `quantity`, plus `quantityMax` for a
 * range. People write them as "1½", "1 1/2" or "2–3", so the web client
 * shows and reads them with these two functions. Like `shared/units`, this
 * has no server or browser imports, so it's tested once, in the Jest suite.
 */

/** Units shown as decimals (250 g, 1.5 l). Every other unit, and a count, gets fractions. */
const METRIC_UNITS: ReadonlySet<string> = new Set(['g', 'kg', 'ml', 'l']);

/** The fractions a recipe actually uses: eighths, plus thirds. */
const FRACTIONS: ReadonlyArray<readonly [value: number, glyph: string]> = [
    [1 / 8, '⅛'],
    [1 / 4, '¼'],
    [1 / 3, '⅓'],
    [3 / 8, '⅜'],
    [1 / 2, '½'],
    [5 / 8, '⅝'],
    [2 / 3, '⅔'],
    [3 / 4, '¾'],
    [7 / 8, '⅞'],
];

/** Glyph → value, for reading "½" or "1½". */
const GLYPH_VALUES: ReadonlyMap<string, number> = new Map(FRACTIONS.map(([value, glyph]) => [glyph, value]));

/**
 * How close a value must be to a fraction (or a whole number) to be shown as
 * one. 0.02 turns 0.33 into ⅓ and 0.66 into ⅔, but leaves 0.3 as a decimal.
 */
const TOLERANCE = 0.02;

/** Up to two decimal places, without trailing zeros: 1.5, 0.33, 250. */
function formatDecimal(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/** A whole number plus a fraction glyph ("1½", "⅓", "2"), or a decimal when no fraction is close. */
function formatFraction(value: number): string {
    const whole = Math.floor(value);
    const rest = value - whole;
    if (rest < TOLERANCE) return String(whole);
    if (1 - rest < TOLERANCE) return String(whole + 1);
    const match = FRACTIONS.find(([fraction]) => Math.abs(rest - fraction) < TOLERANCE);
    if (!match) return formatDecimal(value);
    return whole === 0 ? match[1] : `${whole}${match[1]}`;
}

/**
 * Show an ingredient line's amount, without its unit.
 *
 * @param quantity - The line's quantity; null means "to taste" or unspecified.
 * @param quantityMax - The top of a range, or null.
 * @param unit - The line's canonical unit symbol, or null for a count.
 *               Metric units are shown as decimals; everything else as fractions.
 * @returns The amount, such as "1½", "250" or "2–3"; an empty string when there's no quantity.
 *
 * @example
 * formatQuantity(1.5, null, 'tbsp'); // '1½'
 * formatQuantity(250, null, 'g');    // '250'
 * formatQuantity(2, 3, null);        // '2–3'
 */
export function formatQuantity(quantity: number | null, quantityMax: number | null, unit: string | null): string {
    if (quantity === null) return '';
    const format = unit !== null && METRIC_UNITS.has(unit) ? formatDecimal : formatFraction;
    return quantityMax === null ? format(quantity) : `${format(quantity)}–${format(quantityMax)}`;
}

/** The result of reading an amount: numbers for the API, or a message to show next to the input. */
export type ParsedQuantity =
    | { quantity: number | null; quantityMax: number | null }
    | { error: string };

const READ_ERROR = "Couldn't read that amount. Try 2, 1.5, 1 1/2, ½ or 2-3.";

/** Read one amount, such as "2", "1.5", "1/2", "1 1/2", "½" or "1½". Returns null if it can't. */
function parseAmount(text: string): number | null {
    let match = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text); // 1 1/2
    if (match) {
        const [, whole, numerator, denominator] = match.map(Number);
        return denominator === 0 ? null : whole + numerator / denominator;
    }
    match = /^(\d+)\s*\/\s*(\d+)$/.exec(text); // 1/2
    if (match) {
        const [, numerator, denominator] = match.map(Number);
        return denominator === 0 ? null : numerator / denominator;
    }
    match = /^(\d*)\s*([⅛¼⅓⅜½⅝⅔¾⅞])$/.exec(text); // ½, 1½, 1 ½
    if (match) {
        const whole = match[1] === '' ? 0 : Number(match[1]);
        return whole + (GLYPH_VALUES.get(match[2]) ?? 0);
    }
    if (/^(\d+(\.\d+)?|\.\d+)$/.test(text)) return Number(text); // 2, 1.5, .5
    return null;
}

/**
 * Read an amount as typed into the recipe editor.
 *
 * Accepts whole numbers, decimals, fractions ("1/2", "1 1/2"), fraction
 * glyphs ("½", "1½") and ranges joined by "-", "–", "—" or "to" ("2-3").
 * A blank input means no quantity ("to taste").
 *
 * @param text - What was typed.
 * @returns `{ quantity, quantityMax }` ready for the API, or `{ error }` with a
 *          message to show. It never guesses: anything unclear is an error.
 *
 * @example
 * parseQuantity('1 1/2'); // { quantity: 1.5, quantityMax: null }
 * parseQuantity('2-3');   // { quantity: 2, quantityMax: 3 }
 * parseQuantity('');      // { quantity: null, quantityMax: null }
 */
export function parseQuantity(text: string): ParsedQuantity {
    const trimmed = text.trim();
    if (trimmed === '') return { quantity: null, quantityMax: null };

    const parts = trimmed.split(/\s*(?:-|–|—|\bto\b)\s*/i);
    if (parts.length > 2) return { error: READ_ERROR };

    const amounts = parts.map(parseAmount);
    if (amounts.some((amount) => amount === null)) return { error: READ_ERROR };
    const [quantity, quantityMax = null] = amounts as number[];

    if (quantity <= 0 || (quantityMax !== null && quantityMax <= 0)) {
        return { error: 'The amount must be more than 0.' };
    }
    if (quantityMax !== null && quantityMax < quantity) {
        return { error: 'In a range, the second amount must be at least the first.' };
    }
    return { quantity, quantityMax };
}
