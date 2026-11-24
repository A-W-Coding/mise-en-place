/**
 * @module shared/quantity
 * Showing and reading ingredient amounts (F5), and step timers' lengths (3b).
 *
 * The API stores amounts as numbers: `quantity`, plus `quantityMax` for a
 * range, and a canonical `unit`. People write them as "1½ tbsp", "1 1/2" or
 * "2–3 cloves", so the web client shows them with `formatAmount()` and reads
 * them back with `parseAmount()`. A step's timer is stored in seconds and
 * written as "15 min" or "1 h 30 min": `formatDuration()` and
 * `parseDuration()`. Like `shared/units`, this has no server or browser
 * imports, so it's tested once, in the Jest suite.
 */

import { LIMITS } from './limits.js';
import { canonicaliseUnit, type Unit } from './units.js';

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

/** Units written as words, which take a plural: "2 cloves", "1–2 cans". Symbols such as g and tsp don't. */
const PLURALS: Readonly<Record<string, string>> = {
    cup: 'cups',
    pinch: 'pinches',
    clove: 'cloves',
    slice: 'slices',
    can: 'cans',
    bunch: 'bunches',
    handful: 'handfuls',
};

/**
 * Show a line's whole amount, quantity and unit together, as a recipe writes it.
 * A word unit becomes plural when the amount, or the top of a range, is over 1.
 * A line with no quantity shows nothing, even if it has a unit.
 *
 * @example
 * formatAmount(100, null, 'g');    // '100 g'
 * formatAmount(1, 2, 'tsp');       // '1–2 tsp'
 * formatAmount(2, null, 'clove');  // '2 cloves'
 * formatAmount(0.5, null, null);   // '½'
 */
export function formatAmount(quantity: number | null, quantityMax: number | null, unit: string | null): string {
    const amount = formatQuantity(quantity, quantityMax, unit);
    if (amount === '' || unit === null) return amount;
    const plural = (quantityMax ?? quantity ?? 0) > 1 ? PLURALS[unit] : undefined;
    return `${amount} ${plural ?? unit}`;
}

/** The result of reading an amount: numbers for the API, or a message to show next to the input. */
export type ParsedQuantity =
    | { quantity: number | null; quantityMax: number | null }
    | { error: string };

const READ_ERROR = "Couldn't read that amount. Try 2, 1.5, 1 1/2, ½ or 2-3.";

/** Read one number, such as "2", "1.5", "1/2", "1 1/2", "½" or "1½". Returns null if it can't. */
function parseNumber(text: string): number | null {
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

    const amounts = parts.map(parseNumber);
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

/** A whole amount read from the editor's one Amount box: numbers and a unit for the API, or a message. */
export type ParsedAmount =
    | { quantity: number | null; quantityMax: number | null; unit: Unit | null }
    | { error: string };

const AMOUNT_ERROR = "Couldn't read that amount. Try 100 g, 1½ tbsp or 2-3.";

/**
 * Read an ingredient line's amount and unit, typed together as a recipe
 * writes them: "100 g", "1½ tbsp", "2-3 cloves", "1 can", or just "3" for a
 * count. The unit is the word (or words, as in "fl oz") at the end, and any
 * spelling `canonicaliseUnit()` knows is accepted ("grams", "Tbsp."). This
 * reads back everything `formatAmount()` writes.
 *
 * Like `parseQuantity()`, it never guesses: "3 eggs" is an error, because
 * "eggs" belongs in the Ingredient box, and "pinch" with no number is one too.
 *
 * @example
 * parseAmount('100g');        // { quantity: 100, quantityMax: null, unit: 'g' }
 * parseAmount('1-2 tsp');     // { quantity: 1, quantityMax: 2, unit: 'tsp' }
 * parseAmount('2 cloves');    // { quantity: 2, quantityMax: null, unit: 'clove' }
 * parseAmount('');            // { quantity: null, quantityMax: null, unit: null }
 */
export function parseAmount(text: string): ParsedAmount {
    const trimmed = text.trim();
    if (trimmed === '') return { quantity: null, quantityMax: null, unit: null };

    // The unit is the run of letters at the end (with spaces or dots, for "fl oz" or "tbsp.")
    const match = /^(.*?)\s*([a-z][a-z .]*)$/i.exec(trimmed);
    const numberText = match ? match[1] : trimmed;
    const unitText = match ? match[2].trim() : '';

    let unit: Unit | null = null;
    if (unitText !== '') {
        const symbol = canonicaliseUnit(unitText);
        if (!symbol) {
            return numberText === ''
                ? { error: AMOUNT_ERROR }
                : { error: `“${unitText}” isn't a unit. For a count, type just the number.` };
        }
        unit = symbol;
        if (numberText === '') return { error: `Put a number before “${unitText}”, like 1 ${unit}.` };
    }

    const parsed = parseQuantity(numberText);
    if ('error' in parsed) return { error: parsed.error === READ_ERROR ? AMOUNT_ERROR : parsed.error };
    return { ...parsed, unit };
}

// ── Timer lengths (3b) ─────────────────────────────────────────────────────

/** The result of reading a timer's length: whole seconds for the API, or a message to show. */
export type ParsedDuration = { seconds: number } | { error: string };

type DurationUnit = 'h' | 'min' | 's';

/** Seconds in each unit, largest first: the order a length is written in. */
const DURATION_UNITS: ReadonlyArray<readonly [unit: DurationUnit, seconds: number]> = [
    ['h', 3600],
    ['min', 60],
    ['s', 1],
];

/** Every spelling of each unit, as typed. */
const DURATION_WORDS: Readonly<Record<string, DurationUnit>> = {
    h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
    m: 'min', min: 'min', mins: 'min', minute: 'min', minutes: 'min',
    s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
};

const DURATION_ERROR = "Couldn't read that. Try 90 s, 15 min or 1 h 30 min.";

/**
 * Show a timer's length as a cook writes it: "20 min", "1 h 30 min", "45 s".
 * `parseDuration()` reads it back.
 *
 * @example
 * formatDuration(1200); // '20 min'
 * formatDuration(5400); // '1 h 30 min'
 * formatDuration(90);   // '1 min 30 s'
 */
export function formatDuration(seconds: number): string {
    let rest = Math.round(seconds);
    const parts: string[] = [];
    for (const [unit, size] of DURATION_UNITS) {
        const count = Math.floor(rest / size);
        rest -= count * size;
        if (count > 0) parts.push(`${count} ${unit}`);
    }
    return parts.length > 0 ? parts.join(' ') : '0 s';
}

/**
 * Read a timer's length, as typed into a step's timer sheet.
 *
 * A number on its own is minutes ("15"). Otherwise it's numbers with units,
 * largest first, each unit once: "90 s", "15 min", "1.5 h", "1 h 30 min",
 * "1h30m", "2 hours and 15 minutes". A number left at the end takes the
 * next smaller unit, so "1 h 30" is 1 h 30 min. The result is rounded to
 * whole seconds, and must be from 1 second to a day (`LIMITS.timerSeconds`).
 *
 * Like `parseAmount()`, it never guesses: "1:30" could be 1 h 30 min or
 * 1 min 30 s, so it's an error.
 *
 * @example
 * parseDuration('15');        // { seconds: 900 }
 * parseDuration('1 h 30 min'); // { seconds: 5400 }
 * parseDuration('1:30');      // { error: "Couldn't read that…" }
 */
export function parseDuration(text: string): ParsedDuration {
    const cleaned = text.trim().toLowerCase().replace(/,|\band\b/g, ' ').trim();
    if (cleaned === '') return { error: 'Type how long, like 15 min.' };

    let total: number;
    if (/^(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
        total = Number(cleaned) * 60;
    } else {
        total = 0;
        // Each piece is a number and the word after it, which may be missing on the last one
        const piece = /(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)\s*/y;
        let previous = -1;
        let position = 0;
        while (position < cleaned.length) {
            piece.lastIndex = position;
            const match = piece.exec(cleaned);
            if (!match) return { error: DURATION_ERROR };
            position = piece.lastIndex;

            const word = match[2];
            let index: number;
            if (word === '') {
                // Only the last number may go without a unit, and only after one that had one
                if (position < cleaned.length || previous === -1) return { error: DURATION_ERROR };
                index = previous + 1;
            } else {
                const unit = DURATION_WORDS[word];
                if (!unit) return { error: DURATION_ERROR };
                index = DURATION_UNITS.findIndex(([candidate]) => candidate === unit);
            }
            const entry = DURATION_UNITS[index];
            if (!entry || index <= previous) return { error: DURATION_ERROR };
            total += Number(match[1]) * entry[1];
            previous = index;
        }
    }

    const seconds = Math.round(total);
    const { min, max } = LIMITS.timerSeconds;
    if (seconds < min) return { error: 'A timer needs to be at least 1 second.' };
    if (seconds > max) return { error: 'Keep a timer to a day (24 h) or less.' };
    return { seconds };
}
