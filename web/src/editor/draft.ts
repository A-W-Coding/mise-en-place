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
 *
 * The method is sections of steps (3b). Until Step 22's screens, each
 * section is one box of text, a step per line; a step kept as it was keeps
 * its timer, and a line keeps the section it was in.
 */

import { LIMITS } from '../../../shared/limits';
import { formatAmount, parseAmount } from '../../../shared/quantity';
import type { Recipe } from '../api/types';
import { methodSteps } from '../format';

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
    /** The section the line is grouped under (a `SectionDraft` key), or none. */
    sectionKey?: string | null;
}

/** A section of the method as the editor holds it: its name, and its steps as text, one per line. */
export interface SectionDraft {
    key: string;
    name: string;
    text: string;
    /** Each saved step's timer, by its text, so a step kept as it was keeps its timer. */
    timers: Record<string, number>;
}

export interface RecipeDraft {
    name: string;
    description: string;
    servings: string;
    prepTime: string;
    cookTime: string;
    sections: SectionDraft[];
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

/** Where a section's problem shows: its name, or its box of steps. */
export type SectionField = 'name' | 'steps';
export const sectionErrorKey = (key: string, field: SectionField) => `section:${key}:${field}`;

let nextKey = 0;
export function newLine(focus?: LineDraft['focus']): LineDraft {
    nextKey += 1;
    return { key: `new-${nextKey}`, amount: '', ingredient: null, ingredientText: '', note: '', showNote: false, focus };
}

let nextSection = 0;
/** An empty "Method" section: what a recipe with no method starts with. */
function newSection(): SectionDraft {
    nextSection += 1;
    return { key: `new-section-${nextSection}`, name: 'Method', text: '', timers: {} };
}

/** A new recipe starts with one empty line, and an empty method, to fill in. */
export function newDraft(): RecipeDraft {
    return {
        name: '',
        description: '',
        servings: '1',
        prepTime: '',
        cookTime: '',
        sections: [newSection()],
        lines: [newLine()],
    };
}

/** A saved section, ready to edit. */
function sectionDraft(key: string, section: SectionBody): SectionDraft {
    const timers: Record<string, number> = {};
    for (const step of section.steps) if (step.timerSeconds !== null) timers[step.text] = step.timerSeconds;
    return { key, name: section.name, text: section.steps.map((step) => step.text).join('\n'), timers };
}

/** A saved line, ready to edit. The amount is shown as the recipe page shows it. */
function lineDraft(key: string, line: Omit<LineBody, 'sectionIndex'>, sectionKey: string | null): LineDraft {
    const amount = formatAmount(line.quantity, line.quantityMax, line.unit);
    return {
        key,
        amount,
        ingredient: { id: line.ingredientId, name: line.ingredientName },
        ingredientText: line.ingredientName,
        note: line.note ?? '',
        showNote: line.note !== null && line.note !== '',
        saved: { amount, quantity: line.quantity, quantityMax: line.quantityMax, unit: line.unit },
        sectionKey,
    };
}

function fieldsDraft(saved: Omit<DraftBody, 'ingredients' | 'sections'>): Omit<RecipeDraft, 'lines' | 'sections'> {
    return {
        name: saved.name,
        description: saved.description ?? '',
        servings: String(saved.servings),
        prepTime: saved.prepTime === null ? '' : String(saved.prepTime),
        cookTime: saved.cookTime === null ? '' : String(saved.cookTime),
    };
}

/** An existing recipe, ready to edit. Its sections keep their ids as keys, so each line finds its own. */
export function draftFromRecipe(recipe: Recipe): RecipeDraft {
    return {
        ...fieldsDraft(recipe),
        sections: recipe.sections.length > 0 ? recipe.sections.map((section) => sectionDraft(section.id, section)) : [newSection()],
        lines: recipe.recipeIngredients.map((line) =>
            lineDraft(line.id, { ...line, ingredientId: line.ingredient.id, ingredientName: line.ingredient.name }, line.sectionId),
        ),
    };
}

/** A version saved on the device and not yet uploaded, ready to edit again (3c). */
export function draftFromBody(body: DraftBody): RecipeDraft {
    const sectionKey = (index: number) => `saved-section-${index}`;
    return {
        ...fieldsDraft(body),
        sections: body.sections.length > 0 ? body.sections.map((section, index) => sectionDraft(sectionKey(index), section)) : [newSection()],
        lines: body.ingredients.map((line, index) =>
            lineDraft(`saved-${index}`, line, line.sectionIndex === null ? null : sectionKey(line.sectionIndex)),
        ),
    };
}

/** True when the draft differs from where it started, ignoring which box wants focus. */
export function isDirty(initial: RecipeDraft, current: RecipeDraft): boolean {
    const comparable = (draft: RecipeDraft) =>
        JSON.stringify({
            ...draft,
            lines: draft.lines.map((line) => [
                line.key,
                line.amount,
                line.ingredient?.id ?? null,
                line.ingredientText,
                line.note,
                line.sectionKey ?? null,
            ]),
        });
    return comparable(initial) !== comparable(current);
}

/** A line with nothing in it is left out rather than refused. */
function isBlank(line: LineDraft): boolean {
    return line.amount.trim() === '' && line.ingredientText.trim() === '' && line.ingredient === null && line.note.trim() === '';
}

// ── Editing ────────────────────────────────────────────────────────────────

export type DraftAction =
    | { type: 'field'; field: Exclude<keyof RecipeDraft, 'lines' | 'sections'>; value: string }
    | { type: 'sectionText'; key: string; text: string }
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
        case 'sectionText':
            return {
                ...draft,
                sections: draft.sections.map((section) => (section.key === action.key ? { ...section, text: action.text } : section)),
            };
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
    /** Its section, by position in `sections`, or none (3b). */
    sectionIndex: number | null;
}

/** One step as it's saved (3b). */
export interface StepBody {
    text: string;
    timerSeconds: number | null;
}

/** One section of the method as it's saved (3b). */
export interface SectionBody {
    name: string;
    steps: StepBody[];
}

/** A recipe as the editor saves it, online or kept on the device. */
export interface DraftBody {
    name: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    sections: SectionBody[];
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
        sectionIndex: number | null;
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
    | { body: DraftBody; lineKeys: string[]; sectionKeys: string[] }
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
 * once, each next to its box. `lineKeys` and `sectionKeys` map the body's
 * indexes back to rows and sections, for errors the API finds
 * (`ingredients.2.unit`, `sections.0.steps.3.text`).
 *
 * A section is saved if it has steps or a line in it; an empty "Method" is
 * left out, so a recipe with no method has no sections, as the migration
 * leaves it.
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

    const usedSections = new Set(draft.lines.filter((line) => !isBlank(line)).map((line) => line.sectionKey));
    const sections: SectionBody[] = [];
    const sectionKeys: string[] = [];
    for (const section of draft.sections) {
        const steps = methodSteps(section.text);
        const name = section.name.trim();
        if (steps.length === 0 && !usedSections.has(section.key)) continue;
        if (name === '') errors[sectionErrorKey(section.key, 'name')] = 'Give the section a name.';
        else if (name.length > LIMITS.sectionName) {
            errors[sectionErrorKey(section.key, 'name')] = `Keep the section's name to ${LIMITS.sectionName} characters or fewer.`;
        }
        if (steps.some((step) => step.length > LIMITS.stepText)) {
            errors[sectionErrorKey(section.key, 'steps')] = `Keep each step to ${LIMITS.stepText} characters or fewer.`;
        }
        sections.push({ name, steps: steps.map((text) => ({ text, timerSeconds: section.timers[text] ?? null })) });
        sectionKeys.push(section.key);
    }

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
            const sectionIndex = line.sectionKey ? sectionKeys.indexOf(line.sectionKey) : -1;
            ingredients.push({
                ingredientId: line.ingredient.id,
                ingredientName: line.ingredient.name,
                ...amount,
                note,
                sectionIndex: sectionIndex === -1 ? null : sectionIndex,
            });
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
            sections,
            ingredients,
        },
        lineKeys,
        sectionKeys,
    };
}

const LINE_FIELDS: Record<string, LineField> = {
    quantity: 'amount',
    quantityMax: 'amount',
    unit: 'amount',
    ingredientId: 'ingredient',
    note: 'note',
};

const RECIPE_FIELDS = new Set(['name', 'description', 'servings', 'prepTime', 'cookTime']);

/**
 * Put the API's per-field messages next to their boxes. `ingredients.2.unit`
 * is the third line sent, which `lineKeys` turns back into a row, and
 * `sections.1.steps.0.text` the second section's box, through `sectionKeys`.
 * Anything else is shown for the whole form.
 */
export function mapServerErrors(fields: Record<string, string>, lineKeys: string[], sectionKeys: string[] = []): DraftErrors {
    const errors: DraftErrors = {};
    const unplaced: string[] = [];

    for (const [path, message] of Object.entries(fields)) {
        const line = /^ingredients\.(\d+)\.(\w+)$/.exec(path);
        const key = line ? lineKeys[Number(line[1])] : undefined;
        const field = line ? LINE_FIELDS[line[2]] : undefined;
        const section = /^sections\.(\d+)\.(name|steps)\b/.exec(path);
        const sectionKey = section ? sectionKeys[Number(section[1])] : undefined;

        if (key && field) errors[lineErrorKey(key, field)] = message;
        else if (sectionKey && section) errors[sectionErrorKey(sectionKey, section[2] as SectionField)] = message;
        else if (RECIPE_FIELDS.has(path)) errors[path] = message;
        else unplaced.push(`${path}: ${message}`);
    }

    if (unplaced.length > 0) errors.form = unplaced.join(' ');
    return errors;
}
