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
 * The method is sections, each a list of steps with an optional timer (3b).
 * An ingredient line can be put in a section. The lines are kept in the
 * order they're shown, grouped: lines in no section first, then each
 * section's, in the sections' order. Moving a line keeps it in its group,
 * and changing its section moves it to the end of the new group, so what's
 * saved (each line's position) always matches what the editor showed.
 *
 * A recipe also has tags, in its own order, and equipment lines (3b). Like
 * an ingredient, a tag or item picked offline that doesn't exist yet has a
 * null id: it's created by name when the recipe is sent (a new tag with the
 * colour chosen for it).
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

/** A tag on the recipe (3b). A null id is a new tag, created with its name and colour when the recipe is sent. */
export interface PickedTag {
    id: string | null;
    name: string;
    color: string | null;
}

/** One equipment line as the editor holds it (3b). */
export interface EquipmentDraft {
    key: string;
    /** The item picked, or null; a null id is a new item, created by name when the recipe is sent. */
    item: PickedIngredient | null;
    /** The Item box's text, which may not be a picked item yet. */
    itemText: string;
    quantity: number;
    optional: boolean;
    /** Focus its Item box when it first appears, after Add equipment. */
    focus?: boolean;
}

/** One step of the method: its text, and its timer in seconds, if it has one (3b). */
export interface StepDraft {
    key: string;
    text: string;
    timerSeconds: number | null;
    /** Focus its box when it first appears: after Add step, or Enter in the step before. */
    focus?: boolean;
}

/** A section of the method as the editor holds it: its name, and its steps (3b). */
export interface SectionDraft {
    key: string;
    name: string;
    steps: StepDraft[];
    /** Focus its name box when it first appears, after Add section. */
    focus?: boolean;
}

export interface RecipeDraft {
    name: string;
    description: string;
    servings: string;
    prepTime: string;
    cookTime: string;
    sections: SectionDraft[];
    lines: LineDraft[];
    /** In the recipe's order: the list shows the first two (3b). */
    tags: PickedTag[];
    equipment: EquipmentDraft[];
}

/**
 * Error messages by where they show: a recipe field ("name", "servings"…),
 * a line's box (`line:<key>:amount`, `:ingredient` or `:note`), a section's
 * name or steps, a step's box or timer, or the whole form ("form").
 */
export type DraftErrors = Record<string, string>;

export type LineField = 'amount' | 'ingredient' | 'note';
export const lineErrorKey = (key: string, field: LineField) => `line:${key}:${field}`;

/** Where a section's problem shows: its name, or under its steps. */
export type SectionField = 'name' | 'steps';
export const sectionErrorKey = (key: string, field: SectionField) => `section:${key}:${field}`;

/** Where a step's problem shows: its box, or its timer. */
export type StepField = 'text' | 'timer';
export const stepErrorKey = (key: string, field: StepField) => `step:${key}:${field}`;

/** Where an equipment line's problem shows: its Item box, or its count (3b). */
export type EquipmentField = 'item' | 'quantity';
export const equipmentErrorKey = (key: string, field: EquipmentField) => `equipment:${key}:${field}`;

/** Where a problem with the tags shows: under them (3b). */
export const TAGS_ERROR = 'tags';

let nextKey = 0;
export function newLine(focus?: LineDraft['focus'], sectionKey: string | null = null): LineDraft {
    nextKey += 1;
    return { key: `new-${nextKey}`, amount: '', ingredient: null, ingredientText: '', note: '', showNote: false, focus, sectionKey };
}

let nextEquipment = 0;
export function newEquipmentLine(focus = false): EquipmentDraft {
    nextEquipment += 1;
    return { key: `new-equipment-${nextEquipment}`, item: null, itemText: '', quantity: 1, optional: false, focus };
}

let nextStep = 0;
export function newStep(text = '', focus = false): StepDraft {
    nextStep += 1;
    return { key: `new-step-${nextStep}`, text, timerSeconds: null, focus };
}

let nextSection = 0;
/** A new section, with one empty step to fill in. A recipe with no method starts with one called "Method". */
function newSection(name: string, focus = false): SectionDraft {
    nextSection += 1;
    return { key: `new-section-${nextSection}`, name, steps: [newStep()], focus };
}

/** A new recipe starts with one empty line, and an empty method, to fill in. */
export function newDraft(): RecipeDraft {
    return {
        name: '',
        description: '',
        servings: '1',
        prepTime: '',
        cookTime: '',
        sections: [newSection('Method')],
        lines: [newLine()],
        tags: [],
        equipment: [],
    };
}

/** A saved section, ready to edit. `stepKey` names each step, so the API's messages can find it. */
function sectionDraft(key: string, section: SectionBody, stepKey: (index: number) => string): SectionDraft {
    return {
        key,
        name: section.name,
        // A section kept only to group lines still gets a box, to add a step to
        steps: section.steps.length > 0
            ? section.steps.map((step, index) => ({ key: stepKey(index), text: step.text, timerSeconds: step.timerSeconds }))
            : [newStep()],
    };
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

type Fields = Omit<DraftBody, 'ingredients' | 'sections' | 'tags' | 'equipment'>;

function fieldsDraft(saved: Fields): Omit<RecipeDraft, 'lines' | 'sections' | 'tags' | 'equipment'> {
    return {
        name: saved.name,
        description: saved.description ?? '',
        servings: String(saved.servings),
        prepTime: saved.prepTime === null ? '' : String(saved.prepTime),
        cookTime: saved.cookTime === null ? '' : String(saved.cookTime),
    };
}

/** An existing recipe, ready to edit. Its sections and steps keep their ids as keys, so each line finds its own. */
export function draftFromRecipe(recipe: Recipe): RecipeDraft {
    const sections = recipe.sections.length > 0
        ? recipe.sections.map((section) => sectionDraft(section.id, section, (index) => section.steps[index]?.id ?? `${section.id}-${index}`))
        : [newSection('Method')];
    const lines = recipe.recipeIngredients.map((line) =>
        lineDraft(line.id, { ...line, ingredientId: line.ingredient.id, ingredientName: line.ingredient.name }, line.sectionId),
    );
    return {
        ...fieldsDraft(recipe),
        sections,
        lines: groupLines(lines, sections),
        tags: recipe.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color })),
        equipment: recipe.equipment.map((line) =>
            equipmentDraft(line.id, { equipmentId: line.equipment.id, name: line.equipment.name, quantity: line.quantity, optional: line.optional }),
        ),
    };
}

/** A saved equipment line, ready to edit. */
function equipmentDraft(key: string, line: EquipmentBody): EquipmentDraft {
    return {
        key,
        item: { id: line.equipmentId, name: line.name },
        itemText: line.name,
        quantity: line.quantity,
        optional: line.optional,
    };
}

/** A version saved on the device and not yet uploaded, ready to edit again (3c). */
export function draftFromBody(body: DraftBody): RecipeDraft {
    const sectionKey = (index: number) => `saved-section-${index}`;
    const sections = body.sections.length > 0
        ? body.sections.map((section, index) => sectionDraft(sectionKey(index), section, (step) => `saved-step-${index}-${step}`))
        : [newSection('Method')];
    const lines = body.ingredients.map((line, index) =>
        lineDraft(`saved-${index}`, line, line.sectionIndex === null ? null : sectionKey(line.sectionIndex)),
    );
    return {
        ...fieldsDraft(body),
        sections,
        lines: groupLines(lines, sections),
        tags: body.tags.map((tag) => ({ id: tag.tagId, name: tag.name, color: tag.color })),
        equipment: body.equipment.map((line, index) => equipmentDraft(`saved-equipment-${index}`, line)),
    };
}

/** True when the draft differs from where it started, ignoring which box wants focus. */
export function isDirty(initial: RecipeDraft, current: RecipeDraft): boolean {
    const comparable = (draft: RecipeDraft) =>
        JSON.stringify({
            ...draft,
            sections: draft.sections.map((section) => [
                section.key,
                section.name,
                section.steps.map((step) => [step.key, step.text, step.timerSeconds]),
            ]),
            lines: draft.lines.map((line) => [
                line.key,
                line.amount,
                line.ingredient?.id ?? null,
                line.ingredientText,
                line.note,
                line.sectionKey ?? null,
            ]),
            equipment: draft.equipment.map((line) => [line.key, line.item?.id ?? null, line.itemText, line.quantity, line.optional]),
        });
    return comparable(initial) !== comparable(current);
}

/** A line with nothing in it is left out rather than refused. */
function isBlank(line: LineDraft): boolean {
    return line.amount.trim() === '' && line.ingredientText.trim() === '' && line.ingredient === null && line.note.trim() === '';
}

// ── Grouping lines by section ──────────────────────────────────────────────

/** Where a line's group comes: 0 for no section, then 1, 2… for the sections in order. */
function groupIndex(line: LineDraft, sections: SectionDraft[]): number {
    if (!line.sectionKey) return 0;
    const index = sections.findIndex((section) => section.key === line.sectionKey);
    return index === -1 ? 0 : index + 1;
}

/**
 * The lines in the order they're shown: no section first, then each
 * section's, keeping their order within a group. A line whose section is
 * gone is in no section.
 */
export function groupLines(lines: LineDraft[], sections: SectionDraft[]): LineDraft[] {
    return lines
        .map((line, position) => ({ line, position, group: groupIndex(line, sections) }))
        .sort((a, b) => a.group - b.group || a.position - b.position)
        .map(({ line, group }) => (group === 0 && line.sectionKey ? { ...line, sectionKey: null } : line));
}

/** A section's name as the editor shows it, or its number when it has none yet. */
export function sectionTitle(section: SectionDraft, index: number): string {
    return section.name.trim() || `Section ${index + 1}`;
}

/** One group of lines as the editor shows it: its section, or none, and its lines. */
export interface LineGroup {
    section: SectionDraft | null;
    lines: LineDraft[];
}

/** The lines in their groups, in order, leaving out groups with no lines. */
export function lineGroups(draft: RecipeDraft): LineGroup[] {
    const groups: LineGroup[] = [{ section: null, lines: [] }, ...draft.sections.map((section) => ({ section, lines: [] as LineDraft[] }))];
    for (const line of draft.lines) groups[groupIndex(line, draft.sections)]?.lines.push(line);
    return groups.filter((group) => group.lines.length > 0);
}

/**
 * Whether ingredient lines can be put in sections yet: once the method has
 * more than one section, or one with a name of its own. A recipe with just
 * "Method" isn't asked, as the recipe page shows no heading for it.
 */
export function hasNamedSections(sections: { name: string }[]): boolean {
    return sections.length > 1 || (sections.length === 1 && sections[0]?.name.trim() !== 'Method');
}

// ── Editing ────────────────────────────────────────────────────────────────

type LinePatch = Partial<Omit<LineDraft, 'key' | 'sectionKey'>>;
type EquipmentPatch = Partial<Pick<EquipmentDraft, 'item' | 'itemText' | 'quantity' | 'optional'>>;
type StepPatch = Partial<Pick<StepDraft, 'text' | 'timerSeconds'>>;

export type DraftAction =
    | { type: 'field'; field: Exclude<keyof RecipeDraft, 'lines' | 'sections' | 'tags' | 'equipment'>; value: string }
    | { type: 'line'; key: string; patch: LinePatch }
    | { type: 'ingredientText'; key: string; text: string }
    | { type: 'add' }
    | { type: 'remove'; key: string }
    | { type: 'move'; key: string; by: -1 | 1 }
    | { type: 'lineSection'; key: string; sectionKey: string | null }
    | { type: 'sectionName'; key: string; name: string }
    | { type: 'addSection' }
    | { type: 'removeSection'; key: string }
    | { type: 'moveSection'; key: string; by: -1 | 1 }
    | { type: 'step'; key: string; patch: StepPatch }
    | { type: 'addStep'; sectionKey: string }
    | { type: 'splitStep'; key: string; before: string; after: string }
    | { type: 'pasteSteps'; key: string; text: string }
    | { type: 'removeStep'; key: string }
    | { type: 'moveStep'; key: string; by: -1 | 1 }
    | { type: 'addTag'; tag: PickedTag }
    | { type: 'removeTag'; name: string }
    | { type: 'addEquipment' }
    | { type: 'equipment'; key: string; patch: EquipmentPatch }
    | { type: 'equipmentText'; key: string; text: string }
    | { type: 'removeEquipment'; key: string }
    | { type: 'moveEquipment'; key: string; by: -1 | 1 }
    | { type: 'reset'; draft: RecipeDraft };

/** Swap an item with its neighbour, if it has one that way. */
function swap<T>(items: T[], from: number, by: -1 | 1): T[] {
    const to = from + by;
    if (from < 0 || to < 0 || to >= items.length) return items;
    const moved = [...items];
    [moved[from], moved[to]] = [moved[to] as T, moved[from] as T];
    return moved;
}

/** Change the section that holds a step, through `update`. */
function updateSectionOf(draft: RecipeDraft, stepKey: string, update: (section: SectionDraft, index: number) => SectionDraft): RecipeDraft {
    return {
        ...draft,
        sections: draft.sections.map((section) => {
            const index = section.steps.findIndex((step) => step.key === stepKey);
            return index === -1 ? section : update(section, index);
        }),
    };
}

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
        case 'add': {
            // A new line joins the last group, so it appears just above the Add button
            const last = draft.lines[draft.lines.length - 1];
            return { ...draft, lines: [...draft.lines, newLine('amount', last?.sectionKey ?? null)] };
        }
        case 'remove':
            return { ...draft, lines: draft.lines.filter((line) => line.key !== action.key) };
        case 'move': {
            // Only within its group: the line's ⋮ menu changes its section
            const from = draft.lines.findIndex((line) => line.key === action.key);
            const neighbour = draft.lines[from + action.by];
            const line = draft.lines[from];
            if (!line || !neighbour || groupIndex(neighbour, draft.sections) !== groupIndex(line, draft.sections)) return draft;
            return { ...draft, lines: swap(draft.lines, from, action.by) };
        }
        case 'lineSection': {
            // To the end of its new group
            const line = draft.lines.find((candidate) => candidate.key === action.key);
            if (!line || (line.sectionKey ?? null) === action.sectionKey) return draft;
            const others = draft.lines.filter((candidate) => candidate.key !== action.key);
            return { ...draft, lines: groupLines([...others, { ...line, sectionKey: action.sectionKey }], draft.sections) };
        }
        case 'sectionName':
            return {
                ...draft,
                sections: draft.sections.map((section) => (section.key === action.key ? { ...section, name: action.name } : section)),
            };
        case 'addSection':
            return { ...draft, sections: [...draft.sections, newSection('', true)] };
        case 'removeSection': {
            // Its steps go with it; its lines stay, in no section
            const sections = draft.sections.filter((section) => section.key !== action.key);
            const lines = draft.lines.map((line) => (line.sectionKey === action.key ? { ...line, sectionKey: null } : line));
            return { ...draft, sections, lines: groupLines(lines, sections) };
        }
        case 'moveSection': {
            const from = draft.sections.findIndex((section) => section.key === action.key);
            const sections = swap(draft.sections, from, action.by);
            return sections === draft.sections ? draft : { ...draft, sections, lines: groupLines(draft.lines, sections) };
        }
        case 'step':
            return updateSectionOf(draft, action.key, (section) => ({
                ...section,
                steps: section.steps.map((step) => (step.key === action.key ? { ...step, ...action.patch } : step)),
            }));
        case 'addStep':
            return {
                ...draft,
                sections: draft.sections.map((section) =>
                    section.key === action.sectionKey ? { ...section, steps: [...section.steps, newStep('', true)] } : section,
                ),
            };
        case 'splitStep':
            // Enter in a step: what's after the cursor becomes the next step, which takes the focus
            return updateSectionOf(draft, action.key, (section, index) => {
                const steps = [...section.steps];
                const step = steps[index] as StepDraft;
                steps.splice(index, 1, { ...step, text: action.before.trimEnd(), focus: false }, newStep(action.after.trimStart(), true));
                return { ...section, steps };
            });
        case 'pasteSteps':
            // Pasted lines become steps, numbering dropped as the recipe page drops it
            return updateSectionOf(draft, action.key, (section, index) => {
                const [first = '', ...rest] = methodSteps(action.text);
                const steps = [...section.steps];
                const step = steps[index] as StepDraft;
                steps.splice(index, 1, { ...step, text: first }, ...rest.map((text) => newStep(text)));
                return { ...section, steps };
            });
        case 'removeStep':
            return updateSectionOf(draft, action.key, (section) => {
                const steps = section.steps.filter((step) => step.key !== action.key);
                // A section always has a box to type a step in
                return { ...section, steps: steps.length > 0 ? steps : [newStep('', true)] };
            });
        case 'moveStep':
            return updateSectionOf(draft, action.key, (section, index) => ({ ...section, steps: swap(section.steps, index, action.by) }));
        case 'addTag':
            // Names are unique, so a tag already on the recipe isn't added twice
            return draft.tags.some((tag) => tag.name === action.tag.name) ? draft : { ...draft, tags: [...draft.tags, action.tag] };
        case 'removeTag':
            return { ...draft, tags: draft.tags.filter((tag) => tag.name !== action.name) };
        case 'addEquipment':
            return { ...draft, equipment: [...draft.equipment, newEquipmentLine(true)] };
        case 'equipment':
            return {
                ...draft,
                equipment: draft.equipment.map((line) => (line.key === action.key ? { ...line, ...action.patch } : line)),
            };
        case 'equipmentText':
            // Typing something other than the picked name unpicks it, as for an ingredient
            return {
                ...draft,
                equipment: draft.equipment.map((line) =>
                    line.key === action.key
                        ? { ...line, itemText: action.text, item: line.item && line.item.name === action.text.trim().toLowerCase() ? line.item : null }
                        : line,
                ),
            };
        case 'removeEquipment':
            return { ...draft, equipment: draft.equipment.filter((line) => line.key !== action.key) };
        case 'moveEquipment': {
            const from = draft.equipment.findIndex((line) => line.key === action.key);
            const equipment = swap(draft.equipment, from, action.by);
            return equipment === draft.equipment ? draft : { ...draft, equipment };
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

/** One of the recipe's tags as it's saved (3b): by id, or a new one by name and colour (a null id). */
export interface TagBody {
    tagId: string | null;
    name: string;
    color: string | null;
}

/** One equipment line as it's saved (3b): its item by id, or a new one by name (a null id). */
export interface EquipmentBody {
    equipmentId: string | null;
    name: string;
    quantity: number;
    optional: boolean;
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
    tags: TagBody[];
    equipment: EquipmentBody[];
}

/** The body for `POST /api/recipes` or `PATCH /api/recipes/:id`: every ingredient, tag and item by id. */
export interface RecipeBody extends Omit<DraftBody, 'ingredients' | 'tags' | 'equipment'> {
    ingredients: {
        ingredientId: string;
        quantity: number | null;
        quantityMax: number | null;
        unit: string | null;
        note: string | null;
        sectionIndex: number | null;
    }[];
    tagIds: string[];
    equipment: { equipmentId: string; quantity: number; optional: boolean }[];
}

/** The ids of new ingredients, tags and items, by name, once each has been created. */
export interface NewIds {
    ingredient: (name: string) => string;
    tag: (name: string) => string;
    equipment: (name: string) => string;
}

/** The API's body, once every ingredient, tag and item has an id. */
export function apiBody(body: DraftBody, ids: NewIds): RecipeBody {
    const { tags, equipment, ...rest } = body;
    return {
        ...rest,
        ingredients: body.ingredients.map(({ ingredientId, ingredientName, ...line }) => ({
            ingredientId: ingredientId ?? ids.ingredient(ingredientName),
            ...line,
        })),
        tagIds: tags.map((tag) => tag.tagId ?? ids.tag(tag.name)),
        equipment: equipment.map(({ equipmentId, name, ...line }) => ({ equipmentId: equipmentId ?? ids.equipment(name), ...line })),
    };
}

/** Where each part of a body came from in the draft, to put the API's messages back. */
export interface BodyKeys {
    lineKeys: string[];
    sectionKeys: string[];
    /** Each saved section's steps' keys, by position. */
    stepKeys: string[][];
    /** Each saved equipment line's key, by position (3b). */
    equipmentKeys: string[];
}

export type BuildResult = ({ body: DraftBody } & BodyKeys) | { errors: DraftErrors };

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
 * once, each next to its box. The keys map the body's positions back to
 * rows, sections and steps, for errors the API finds (`ingredients.2.unit`,
 * `sections.0.steps.3.text`).
 *
 * Empty step boxes are left out. A section is saved if it has steps or a
 * line in it; an empty one is left out, so a recipe with no method has no
 * sections, as the migration leaves it.
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

    const lines = groupLines(draft.lines, draft.sections).filter((line) => !isBlank(line));
    const usedSections = new Set(lines.map((line) => line.sectionKey));
    const sections: SectionBody[] = [];
    const sectionKeys: string[] = [];
    const stepKeys: string[][] = [];
    for (const section of draft.sections) {
        const steps = section.steps
            .map((step) => ({ ...step, text: step.text.trim() }))
            .filter((step) => step.text !== '');
        const name = section.name.trim();
        if (steps.length === 0 && !usedSections.has(section.key)) continue;
        if (name === '') errors[sectionErrorKey(section.key, 'name')] = 'Give the section a name.';
        else if (name.length > LIMITS.sectionName) {
            errors[sectionErrorKey(section.key, 'name')] = `Keep the section's name to ${LIMITS.sectionName} characters or fewer.`;
        }
        for (const step of steps) {
            if (step.text.length > LIMITS.stepText) {
                errors[stepErrorKey(step.key, 'text')] = `Keep each step to ${LIMITS.stepText} characters or fewer.`;
            }
        }
        sections.push({ name, steps: steps.map((step) => ({ text: step.text, timerSeconds: step.timerSeconds })) });
        sectionKeys.push(section.key);
        stepKeys.push(steps.map((step) => step.key));
    }

    const ingredients: LineBody[] = [];
    const lineKeys: string[] = [];
    for (const line of lines) {
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

    const longTag = draft.tags.find((tag) => tag.name.length > LIMITS.tagName);
    if (longTag) errors[TAGS_ERROR] = `Keep each tag's name to ${LIMITS.tagName} characters or fewer.`;
    const tags = draft.tags.map((tag) => ({ tagId: tag.id, name: tag.name, color: tag.color }));

    const equipment: EquipmentBody[] = [];
    const equipmentKeys: string[] = [];
    for (const line of draft.equipment) {
        const typed = line.itemText.trim();
        if (!line.item && typed === '') continue;
        if (!line.item) {
            errors[equipmentErrorKey(line.key, 'item')] = `Choose “${typed}” from the list, or create it.`;
            continue;
        }
        if (line.item.name.length > LIMITS.equipmentName) {
            errors[equipmentErrorKey(line.key, 'item')] = `Keep the item's name to ${LIMITS.equipmentName} characters or fewer.`;
        }
        const { min, max } = LIMITS.equipmentQuantity;
        if (!Number.isInteger(line.quantity) || line.quantity < min || line.quantity > max) {
            errors[equipmentErrorKey(line.key, 'quantity')] = `From ${min} to ${max}.`;
        }
        equipment.push({ equipmentId: line.item.id, name: line.item.name, quantity: line.quantity, optional: line.optional });
        equipmentKeys.push(line.key);
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
            tags,
            equipment,
        },
        lineKeys,
        sectionKeys,
        stepKeys,
        equipmentKeys,
    };
}

/** Where a draft's parts sit in a body made from it unchanged: for a refused version reopened from the device. */
export function draftKeys(draft: RecipeDraft): BodyKeys {
    return {
        lineKeys: draft.lines.map((line) => line.key),
        sectionKeys: draft.sections.map((section) => section.key),
        stepKeys: draft.sections.map((section) => section.steps.map((step) => step.key)),
        equipmentKeys: draft.equipment.map((line) => line.key),
    };
}

const LINE_FIELDS: Record<string, LineField> = {
    quantity: 'amount',
    quantityMax: 'amount',
    unit: 'amount',
    ingredientId: 'ingredient',
    note: 'note',
};

const STEP_FIELDS: Record<string, StepField> = { text: 'text', timerSeconds: 'timer' };

const EQUIPMENT_FIELDS: Record<string, EquipmentField> = { equipmentId: 'item', quantity: 'quantity', optional: 'quantity' };

const RECIPE_FIELDS = new Set(['name', 'description', 'servings', 'prepTime', 'cookTime']);

/**
 * Put the API's per-field messages next to their boxes. `ingredients.2.unit`
 * is the third line sent, which `lineKeys` turns back into a row;
 * `sections.1.name` the second section's name, through `sectionKeys`; and
 * `sections.1.steps.0.text` that section's first step, through `stepKeys`;
 * `equipment.0.quantity` the first equipment line, through `equipmentKeys`;
 * and `tagIds…` under the tags. Anything else is shown for the whole form.
 */
export function mapServerErrors(fields: Record<string, string>, keys: Partial<BodyKeys>): DraftErrors {
    const { lineKeys = [], sectionKeys = [], stepKeys = [], equipmentKeys = [] } = keys;
    const errors: DraftErrors = {};
    const unplaced: string[] = [];

    for (const [path, message] of Object.entries(fields)) {
        const line = /^ingredients\.(\d+)\.(\w+)$/.exec(path);
        const lineKey = line ? lineKeys[Number(line[1])] : undefined;
        const lineField = line ? LINE_FIELDS[line[2] ?? ''] : undefined;
        const step = /^sections\.(\d+)\.steps\.(\d+)\.(\w+)$/.exec(path);
        const stepKey = step ? stepKeys[Number(step[1])]?.[Number(step[2])] : undefined;
        const stepField = step ? STEP_FIELDS[step[3] ?? ''] : undefined;
        const section = /^sections\.(\d+)\.(name|steps)\b/.exec(path);
        const sectionKey = section ? sectionKeys[Number(section[1])] : undefined;
        const item = /^equipment\.(\d+)\.(\w+)$/.exec(path);
        const itemKey = item ? equipmentKeys[Number(item[1])] : undefined;
        const itemField = item ? EQUIPMENT_FIELDS[item[2] ?? ''] : undefined;

        if (lineKey && lineField) errors[lineErrorKey(lineKey, lineField)] = message;
        else if (stepKey && stepField) errors[stepErrorKey(stepKey, stepField)] = message;
        else if (sectionKey && section) errors[sectionErrorKey(sectionKey, section[2] as SectionField)] = message;
        else if (itemKey && itemField) errors[equipmentErrorKey(itemKey, itemField)] = message;
        else if (path === 'tagIds' || path.startsWith('tagIds.')) errors[TAGS_ERROR] = message;
        else if (RECIPE_FIELDS.has(path)) errors[path] = message;
        else unplaced.push(`${path}: ${message}`);
    }

    if (unplaced.length > 0) errors.form = unplaced.join(' ');
    return errors;
}
