/**
 * @module web/src/tags/colour
 * How a tag looks (3b, technical spec §3.4): its pill, in the tag's own
 * colour, with dark or light text, whichever reads better on it, so any
 * colour works; and its name with a capital first letter, though it's
 * stored in lower case.
 */

import { TAG_COLOUR } from '../../../shared/limits';

/** The colours offered first when a tag is made or recoloured, from the wireframes. Any other can be picked too. */
export const TAG_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
    { name: 'Coral', hex: '#f6c7bd' },
    { name: 'Peach', hex: '#ffd8c2' },
    { name: 'Butter', hex: '#f7e8a6' },
    { name: 'Sage', hex: '#d9e7d3' },
    { name: 'Mint', hex: '#c6e7df' },
    { name: 'Sky', hex: '#c8ddf4' },
    { name: 'Lavender', hex: '#d7d1f2' },
    { name: 'Rose', hex: '#f7d0e1' },
    { name: 'Sand', hex: '#e3dcd2' },
    { name: 'Slate', hex: '#d5d9de' },
];

/**
 * The text colours a pill chooses between: black and white. Only that pair
 * guarantees WCAG AA (4.5:1) on any colour: the worst case, a mid grey, is
 * 4.58:1. The theme's near-black text (#16181d) would fall to 4.2:1 there.
 */
export const DARK_TEXT = '#000000';
export const LIGHT_TEXT = '#ffffff';

/** A colour channel (0–255) as WCAG's relative luminance needs it. */
function channel(value: number): number {
    const fraction = value / 255;
    return fraction <= 0.03928 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2's relative luminance of a `#rrggbb` colour, from 0 (black) to 1 (white). */
export function luminance(hex: string): number {
    const value = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

/** The contrast ratio between two luminances, from 1 to 21. */
function contrast(a: number, b: number): number {
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The text colour for a pill on `background`: black or white, whichever
 * contrasts more with it.
 */
export function readableText(background: string): string {
    const light = luminance(background);
    return contrast(light, luminance(DARK_TEXT)) >= contrast(light, 1) ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * A pill's background and text, for a tag's colour. A tag with no colour,
 * or one that isn't `#rrggbb`, takes the theme's quiet surface.
 */
export function pillColours(color: string | null): { background: string; color: string } {
    if (color === null || !TAG_COLOUR.test(color)) return { background: 'var(--surface2)', color: 'var(--text)' };
    return { background: color, color: readableText(color) };
}

/** A tag's name as a pill shows it: "weeknight" becomes "Weeknight". */
export function tagLabel(name: string): string {
    return name.charAt(0).toLocaleUpperCase('en') + name.slice(1);
}
