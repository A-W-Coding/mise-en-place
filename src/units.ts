/**
 * @module src/units
 * The canonical list of units for recipe ingredient lines (decision D2).
 *
 * Every unit has one canonical symbol, which is what the database stores,
 * and any number of aliases that clients may send instead ("grams" → `g`).
 * A line with no unit is a count, as in "3 eggs".
 *
 * This module is plain data and one function, with no server imports, so
 * the Phase 3 client can reuse it. Phase 6 can add a conversion factor to
 * each entry (F5); `dimension` already says which units convert into which.
 *
 * Units are code rather than a database enum, so adding one is an edit
 * here, not a migration.
 */

/** What a unit measures. Units only convert within the same dimension. */
export type UnitDimension = 'mass' | 'volume' | 'other';

/** One canonical unit and the other spellings that mean it. */
export interface UnitDefinition {
    dimension: UnitDimension;
    aliases: readonly string[];
}

/**
 * Canonical symbol → definition. Aliases are written lowercase, without a
 * trailing full stop; `canonicaliseUnit()` normalises input to match.
 */
export const UNITS = {
    // Mass
    g: { dimension: 'mass', aliases: ['gram', 'grams', 'gr'] },
    kg: { dimension: 'mass', aliases: ['kilogram', 'kilograms', 'kgs'] },
    oz: { dimension: 'mass', aliases: ['ounce', 'ounces'] },
    lb: { dimension: 'mass', aliases: ['pound', 'pounds', 'lbs'] },

    // Volume
    ml: { dimension: 'volume', aliases: ['millilitre', 'millilitres', 'milliliter', 'milliliters', 'mls'] },
    l: { dimension: 'volume', aliases: ['litre', 'litres', 'liter', 'liters'] },
    tsp: { dimension: 'volume', aliases: ['teaspoon', 'teaspoons', 'tsps'] },
    tbsp: { dimension: 'volume', aliases: ['tablespoon', 'tablespoons', 'tbs', 'tbsps'] },
    cup: { dimension: 'volume', aliases: ['cups'] },
    'fl oz': { dimension: 'volume', aliases: ['fluid ounce', 'fluid ounces', 'floz'] },

    // Other
    pinch: { dimension: 'other', aliases: ['pinches'] },
    clove: { dimension: 'other', aliases: ['cloves'] },
    slice: { dimension: 'other', aliases: ['slices'] },
    can: { dimension: 'other', aliases: ['cans', 'tin', 'tins'] },
    bunch: { dimension: 'other', aliases: ['bunches'] },
    handful: { dimension: 'other', aliases: ['handfuls'] },
} as const satisfies Record<string, UnitDefinition>;

/** A canonical unit symbol, such as `g` or `tbsp`. */
export type Unit = keyof typeof UNITS;

/** Every canonical symbol, in the order listed above. Used in error messages. */
export const UNIT_SYMBOLS = Object.keys(UNITS) as Unit[];

/** Lookup from every accepted spelling (symbols and aliases) to its symbol. */
const LOOKUP: ReadonlyMap<string, Unit> = new Map(
    UNIT_SYMBOLS.flatMap((symbol) => [
        [symbol, symbol] as const,
        ...UNITS[symbol].aliases.map((alias) => [alias, symbol] as const),
    ]),
);

/**
 * Convert a unit as a client wrote it into its canonical symbol.
 *
 * Matching ignores case, surrounding spaces, repeated inner spaces and one
 * trailing full stop, so `" Tbsp. "` and `"tablespoons"` both give `tbsp`.
 *
 * @param input - The unit from the request, or null/undefined for none.
 * @returns The canonical symbol; `null` for no unit (null, undefined, or
 *          only spaces), meaning a count; `undefined` if it isn't on the list.
 *
 * @example
 * canonicaliseUnit('grams');   // 'g'
 * canonicaliseUnit('');        // null  (a count, like "3 eggs")
 * canonicaliseUnit('handfull'); // undefined  (unknown: reject it)
 */
export function canonicaliseUnit(input: string | null | undefined): Unit | null | undefined {
    if (input === null || input === undefined) return null;

    const key = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trimEnd();
    if (key === '') return null;

    return LOOKUP.get(key);
}
