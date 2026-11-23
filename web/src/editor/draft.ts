/**
 * @module web/src/editor/draft
 * The recipe editor's state, as plain data and pure functions, so the rules
 * are tested without rendering anything.
 *
 * A draft holds what's typed, as strings. `buildRecipeBody()` turns it into
 * the API's body, checking it first, and `mapServerErrors()` puts a 400's
 * `fields` back next to the inputs they belong to.
 */

import { formatAmount, parseAmount } from '../../../shared/quantity';
import type { Recipe } from '../api/types';

/** An ingredient picked for a line. */
export interface PickedIngredient {
    id: string;
    name: string;
}

export interface LineDraft {
    /** Stable across moves, so React keeps each row's inputs and focus. */
    key: string;
    /** The Amount box: amount and unit together, as typed. */
    amount: string;
    ingredient: PickedIngredient | null;
    /** The Ingredient box's text, which may not be a picked ingredient yet. */
    ingredientText: string;
    note: string;
    showNote: boolean;
    /**
     * The numbers this line was saved with, and how they were shown. While the
     * Amount box still shows that text, the saved numbers are sent back as they
     * were, so an untouched 0.33 isn't rounded to the ⅓ it's shown as.
     */
    saved?: { amount: string; quantity: number | null; quantityMax: number | null; unit: string | null };
    /** Which box to focus when the row first appears: after Add ingredient, or Add note. */
    focus?: 'amount' | 'note';
}

export interface RecipeDraft {
    name: string;
    description: string;
    servings: string;
    prepTime: string;
    cookTime: string;
    instructions: string;
    lines: LineDraft[];
}

/**
 * Error messages by where they show: a recipe field ("name", "servings"…),
 * a line's box (`line:<key>:amount`, `:ingredient` or `:note`), or the whole
 * form ("form").
 */
export type DraftErrors = Record<string, string>;

export type LineField = 'amount' | 'ingredient' | 'note';
export const lineErrorKey = (key: string, field: LineField) => `line:${key}:${field}`;

let nextKey = 0;
export function newLine(focus?: LineDraft['focus']): LineDraft {
    nextKey += 1;
    return { key: `new-${nextKey}`, amount: '', ingredient: null, ingredientText: '', note: '', showNote: false, focus };
}

/** A new recipe starts with one empty line to fill in. */
export function newDraft(): RecipeDraft {
    return { name: '', description: '', servings: '1', prepTime: '', cookTime: '', instructions: '', lines: [newLine()] };
}

/** An existing recipe, ready to edit. Amounts are shown as the recipe page shows them. */
export function draftFromRecipe(recipe: Recipe): RecipeDraft {
    return {
        name: recipe.name,
        description: recipe.description ?? '',
        servings: String(recipe.servings),
        prepTime: recipe.prepTime === null ? '' : String(recipe.prepTime),
        cookTime: recipe.cookTime === null ? '' : String(recipe.cookTime),
        instructions: recipe.instructions ?? '',
        lines: recipe.recipeIngredients.map((line) => {
            const amount = formatAmount(line.quantity, line.quantityMax, line.unit);
            return {
                key: line.id,
                amount,
                ingredient: { id: line.ingredient.id, name: line.ingredient.name },
                ingredientText: line.ingredient.name,
                note: line.note ?? '',
                showNote: line.note !== null && line.note !== '',
                saved: { amount, quantity: line.quantity, quantityMax: line.quantityMax, unit: line.unit },
            };
        }),
    };
}

/** True when the draft differs from where it started, ignoring which box wants focus. */
export function isDirty(initial: RecipeDraft, current: RecipeDraft): boolean {
    const comparable = (draft: RecipeDraft) =>
        JSON.stringify({
            ...draft,
            lines: draft.lines.map((line) => [line.key, line.amount, line.ingredient?.id ?? null, line.ingredientText, line.note]),
        });
    return comparable(initial) !== comparable(current);
}

/** A line with nothing in it is left out rather than refused. */
function isBlank(line: LineDraft): boolean {
    return line.amount.trim() === '' && line.ingredientText.trim() === '' && line.ingredient === null && line.note.trim() === '';
}

// ── Editing ────────────────────────────────────────────────────────────────

export type DraftAction =
    | { type: 'field'; field: Exclude<keyof RecipeDraft, 'lines'>; value: string }
    | { type: 'line'; key: string; patch: Partial<Omit<LineDraft, 'key'>> }
    | { type: 'ingredientText'; key: string; text: string }
    | { type: 'add' }
    | { type: 'remove'; key: string }
    | { type: 'move'; key: string; by: -1 | 1 }
    | { type: 'reset'; draft: RecipeDraft };

export function draftReducer(draft: RecipeDraft, action: DraftAction): RecipeDraft {
    const updateLine = (key: string, update: (line: LineDraft) => LineDraft) => ({
        ...draft,
        lines: draft.lines.map((line) => (line.key === key ? update(line) : line)),
    });

    switch (action.type) {
        case 'field':
            return { ...draft, [action.field]: action.value };
        case 'line':
            return updateLine(action.key, (line) => ({ ...line, ...action.patch }));
        case 'ingredientText':
            // Typing something other than the picked name unpicks it
            return updateLine(action.key, (line) => ({
                ...line,
                ingredientText: action.text,
                ingredient: line.ingredient && line.ingredient.name === action.text.trim().toLowerCase() ? line.ingredient : null,
            }));
        case 'add':
            return { ...draft, lines: [...draft.lines, newLine('amount')] };
        case 'remove':
            return { ...draft, lines: draft.lines.filter((line) => line.key !== action.key) };
        case 'move': {
            const from = draft.lines.findIndex((line) => line.key === action.key);
            const to = from + action.by;
            if (from < 0 || to < 0 || to >= draft.lines.length) return draft;
            const lines = [...draft.lines];
            [lines[from], lines[to]] = [lines[to], lines[from]];
            return { ...draft, lines };
        }
        case 'reset':
            return action.draft;
    }
}

// ── Saving ─────────────────────────────────────────────────────────────────

/** The body for `POST /api/recipes` or `PATCH /api/recipes/:id`. */
export interface RecipeBody {
    name: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    instructions: string | null;
    ingredients: {
        ingredientId: string;
        quantity: number | null;
        quantityMax: number | null;
        unit: string | null;
        note: string | null;
    }[];
}

export type BuildResult =
    | { body: RecipeBody; lineKeys: string[] }
    | { errors: DraftErrors };

const WHOLE_NUMBER = /^\d+$/;

/** Text that's empty once trimmed becomes null, so clearing a box clears the field. */
function optionalText(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/** Read one line's Amount box: the saved numbers if it's unchanged, else `parseAmount()`. */
export function readAmount(line: LineDraft) {
    if (line.saved && line.amount === line.saved.amount) {
        const { quantity, quantityMax, unit } = line.saved;
        return { quantity, quantityMax, unit };
    }
    return parseAmount(line.amount);
}

/**
 * Check the draft and build the API's body. Every problem is reported at
 * once, each next to its box. `lineKeys` maps the body's line indexes back to
 * rows, for errors the API finds (`ingredients.2.unit`).
 */
export function buildRecipeBody(draft: RecipeDraft): BuildResult {
    const errors: DraftErrors = {};

    const name = draft.name.trim();
    if (name === '') errors.name = 'Give the recipe a name.';
    else if (name.length > 200) errors.name = 'Keep the name to 200 characters or fewer.';

    const servings = draft.servings.trim();
    if (!WHOLE_NUMBER.test(servings) || Number(servings) < 1) errors.servings = 'A whole number, 1 or more.';

    const minutes = (field: 'prepTime' | 'cookTime'): number | null => {
        const value = draft[field].trim();
        if (value === '') return null;
        if (!WHOLE_NUMBER.test(value)) errors[field] = 'Whole minutes, or leave it empty.';
        return Number(value);
    };
    const prepTime = minutes('prepTime');
    const cookTime = minutes('cookTime');

    const ingredients: RecipeBody['ingredients'] = [];
    const lineKeys: string[] = [];
    for (const line of draft.lines) {
        if (isBlank(line)) continue;

        const amount = readAmount(line);
        if ('error' in amount) errors[lineErrorKey(line.key, 'amount')] = amount.error;

        const typed = line.ingredientText.trim();
        if (!line.ingredient) {
            errors[lineErrorKey(line.key, 'ingredient')] =
                typed === '' ? 'Choose an ingredient.' : `Choose “${typed}” from the list, or create it.`;
        }

        const note = optionalText(line.note);
        if (note !== null && note.length > 200) {
            errors[lineErrorKey(line.key, 'note')] = 'Keep the note to 200 characters or fewer.';
        }

        if (!('error' in amount) && line.ingredient) {
            ingredients.push({ ingredientId: line.ingredient.id, ...amount, note });
            lineKeys.push(line.key);
        }
    }

    if (Object.keys(errors).length > 0) return { errors };

    return {
        body: {
            name,
            description: optionalText(draft.description),
            servings: Number(servings),
            prepTime,
            cookTime,
            instructions: optionalText(draft.instructions),
            ingredients,
        },
        lineKeys,
    };
}

const LINE_FIELDS: Record<string, LineField> = {
    quantity: 'amount',
    quantityMax: 'amount',
    unit: 'amount',
    ingredientId: 'ingredient',
    note: 'note',
};

const RECIPE_FIELDS = new Set(['name', 'description', 'servings', 'prepTime', 'cookTime', 'instructions']);

/**
 * Put the API's per-field messages next to their boxes. `ingredients.2.unit`
 * is the third line sent, which `lineKeys` turns back into a row. Anything
 * else is shown for the whole form.
 */
export function mapServerErrors(fields: Record<string, string>, lineKeys: string[]): DraftErrors {
    const errors: DraftErrors = {};
    const unplaced: string[] = [];

    for (const [path, message] of Object.entries(fields)) {
        const line = /^ingredients\.(\d+)\.(\w+)$/.exec(path);
        const key = line ? lineKeys[Number(line[1])] : undefined;
        const field = line ? LINE_FIELDS[line[2]] : undefined;

        if (key && field) errors[lineErrorKey(key, field)] = message;
        else if (RECIPE_FIELDS.has(path)) errors[path] = message;
        else unplaced.push(`${path}: ${message}`);
    }

    if (unplaced.length > 0) errors.form = unplaced.join(' ');
    return errors;
}
