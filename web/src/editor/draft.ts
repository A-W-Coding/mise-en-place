/**
 * @module web/src/editor/draft
 * The recipe editor's state, as plain data and pure functions, so the rules
 * are tested without rendering anything.
 *
 * A draft holds what's typed, as strings. `buildRecipeBody()` turns it into
 * what's saved, checking it first against the limits the API shares
 * (`shared/limits.ts`), so a change saved offline is rarely refused when it
 * uploads (3c). `mapServerErrors()` puts a 400's `fields` back next to the
 * inputs they belong to.
 *
 * What's saved names each line's ingredient as well as its id, because an
 * ingredient picked offline may not exist yet: its id is null until the
 * recipe is sent, when it's created by name. `apiBody()` then gives the
 * API's own body, with ids only.
 */

import { LIMITS } from '../../../shared/limits';
import { formatAmount, parseAmount } from '../../../shared/quantity';
import type { Recipe } from '../api/types';

/** An ingredient picked for a line. A null id is a new one, created by name when the recipe is sent (3c). */
export interface PickedIngredient {
    id: string | null;
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

/** A saved line, ready to edit. The amount is shown as the recipe page shows it. */
function lineDraft(key: string, line: LineBody): LineDraft {
    const amount = formatAmount(line.quantity, line.quantityMax, line.unit);
    return {
        key,
        amount,
        ingredient: { id: line.ingredientId, name: line.ingredientName },
        ingredientText: line.ingredientName,
        note: line.note ?? '',
        showNote: line.note !== null && line.note !== '',
        saved: { amount, quantity: line.quantity, quantityMax: line.quantityMax, unit: line.unit },
    };
}

function fieldsDraft(saved: Omit<DraftBody, 'ingredients'>): Omit<RecipeDraft, 'lines'> {
    return {
        name: saved.name,
        description: saved.description ?? '',
        servings: String(saved.servings),
        prepTime: saved.prepTime === null ? '' : String(saved.prepTime),
        cookTime: saved.cookTime === null ? '' : String(saved.cookTime),
        instructions: saved.instructions ?? '',
    };
}

/** An existing recipe, ready to edit. */
export function draftFromRecipe(recipe: Recipe): RecipeDraft {
    return {
        ...fieldsDraft(recipe),
        lines: recipe.recipeIngredients.map((line) =>
            lineDraft(line.id, { ...line, ingredientId: line.ingredient.id, ingredientName: line.ingredient.name }),
        ),
    };
}

/** A version saved on the device and not yet uploaded, ready to edit again (3c). */
export function draftFromBody(body: DraftBody): RecipeDraft {
    return { ...fieldsDraft(body), lines: body.ingredients.map((line, index) => lineDraft(`saved-${index}`, line)) };
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

/** One line as it's saved: its ingredient by id, or a new one by name alone (a null id). */
export interface LineBody {
    ingredientId: string | null;
    ingredientName: string;
    quantity: number | null;
    quantityMax: number | null;
    unit: string | null;
    note: string | null;
}

/** A recipe as the editor saves it, online or kept on the device. */
export interface DraftBody {
    name: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    instructions: string | null;
    ingredients: LineBody[];
}

/** The body for `POST /api/recipes` or `PATCH /api/recipes/:id`: every ingredient by id. */
export interface RecipeBody extends Omit<DraftBody, 'ingredients'> {
    ingredients: {
        ingredientId: string;
        quantity: number | null;
        quantityMax: number | null;
        unit: string | null;
        note: string | null;
    }[];
}

/**
 * The API's body, once every ingredient has an id.
 *
 * @param idOf - The id of a new ingredient, by name, once it's been created.
 */
export function apiBody(body: DraftBody, idOf: (name: string) => string): RecipeBody {
    return {
        ...body,
        ingredients: body.ingredients.map(({ ingredientId, ingredientName, ...line }) => ({
            ingredientId: ingredientId ?? idOf(ingredientName),
            ...line,
        })),
    };
}

export type BuildResult =
    | { body: DraftBody; lineKeys: string[] }
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
    else if (name.length > LIMITS.recipeName) errors.name = `Keep the name to ${LIMITS.recipeName} characters or fewer.`;

    const servings = draft.servings.trim();
    const { min, max } = LIMITS.servings;
    if (!WHOLE_NUMBER.test(servings) || Number(servings) < min || Number(servings) > max) {
        errors.servings = `A whole number from ${min} to ${max}.`;
    }

    const minutes = (field: 'prepTime' | 'cookTime'): number | null => {
        const value = draft[field].trim();
        if (value === '') return null;
        if (!WHOLE_NUMBER.test(value) || Number(value) > LIMITS.minutes.max) {
            errors[field] = `Whole minutes, up to ${LIMITS.minutes.max}, or leave it empty.`;
        }
        return Number(value);
    };
    const prepTime = minutes('prepTime');
    const cookTime = minutes('cookTime');

    const ingredients: LineBody[] = [];
    const lineKeys: string[] = [];
    for (const line of draft.lines) {
        if (isBlank(line)) continue;

        const amount = readAmount(line);
        if ('error' in amount) errors[lineErrorKey(line.key, 'amount')] = amount.error;

        const typed = line.ingredientText.trim();
        if (!line.ingredient) {
            errors[lineErrorKey(line.key, 'ingredient')] =
                typed === '' ? 'Choose an ingredient.' : `Choose “${typed}” from the list, or create it.`;
        } else if (line.ingredient.name.length > LIMITS.ingredientName) {
            errors[lineErrorKey(line.key, 'ingredient')] =
                `Keep the ingredient's name to ${LIMITS.ingredientName} characters or fewer.`;
        }

        const note = optionalText(line.note);
        if (note !== null && note.length > LIMITS.note) {
            errors[lineErrorKey(line.key, 'note')] = `Keep the note to ${LIMITS.note} characters or fewer.`;
        }

        if (!('error' in amount) && line.ingredient) {
            ingredients.push({ ingredientId: line.ingredient.id, ingredientName: line.ingredient.name, ...amount, note });
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
