/**
 * @module web/src/format
 * Text the pages show: times, a recipe's summary line, its method steps, and
 * how old something is.
 * Amounts come from `shared/quantity.ts`, which the API shares.
 */

import type { RecipeSummary } from './api/types';

/** Minutes as a cook reads them: "20 min", "2 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest} min`;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

type Servings = Pick<RecipeSummary, 'servings' | 'prepTime' | 'cookTime'>;

/** The line under a recipe's name in the list: "Serves 2 · 20 min prep · 2 h cook". */
export function listMeta(recipe: Servings): string {
    const parts = [`Serves ${recipe.servings}`];
    if (recipe.prepTime) parts.push(`${formatMinutes(recipe.prepTime)} prep`);
    if (recipe.cookTime) parts.push(`${formatMinutes(recipe.cookTime)} cook`);
    return parts.join(' · ');
}

/** The same facts on the recipe page, where they lead with the label: "Serves 2 · Prep 20 min · Cook 2 h". */
export function recipeMeta(recipe: Servings): string {
    const parts = [`Serves ${recipe.servings}`];
    if (recipe.prepTime) parts.push(`Prep ${formatMinutes(recipe.prepTime)}`);
    if (recipe.cookTime) parts.push(`Cook ${formatMinutes(recipe.cookTime)}`);
    return parts.join(' · ');
}

/**
 * Split Phase 1's plain-text instructions into steps, one per line. A number
 * the text already starts with ("1.", "2)") is dropped, since the page numbers
 * the steps itself. Structured steps replace this in 3b.
 */
export function methodSteps(instructions: string | null): string[] {
    if (!instructions) return [];
    return instructions
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^\d+\s*[.)]\s*/, ''))
        .filter((line) => line !== '');
}

/**
 * How long ago something happened: "just now", "5 minutes ago", "3 hours
 * ago", "yesterday", "60 days ago". English, like the rest of the app.
 */
export function formatAge(then: number, now: number): string {
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 60) return 'just now';
    const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return relative.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return relative.format(-hours, 'hour');
    return relative.format(-Math.floor(hours / 24), 'day');
}
