/**
 * @module web/src/test/fixtures
 * Recipes for the component tests, shaped like the API's responses, and
 * offline copies made from them.
 */

import type { Equipment, Recipe, RecipeEquipment, RecipeIngredient, RecipeSection, RecipeSummary, RecipeTag, Tag } from '../api/types';
import { replaceOfflineCopy, type Snapshot } from '../offline/copy';

const STAMP = '2026-11-23T10:00:00.000Z';
export const BEEF_CHILI_ID = '0b9e6a52-6c1f-4a1e-9f0a-5b7d3c2e1a90';

let counter = 0;
/** A recipe summary, as the list returns it. */
export function summary(name: string, overrides: Partial<RecipeSummary> = {}): RecipeSummary {
    counter += 1;
    return {
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        name,
        description: null,
        servings: 4,
        prepTime: null,
        cookTime: null,
        createdAt: STAMP,
        updatedAt: STAMP,
        tags: [],
        ...overrides,
    };
}

/** A shared tag (3b). Its id comes from its name, so the same name is the same tag. */
export function tag(name: string, color: string | null = null, recipeCount?: number): Tag {
    const id = `40000000-0000-4000-8000-${[...name].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7).toString(16).slice(-12).padStart(12, '0')}`;
    return { id, name, color, createdAt: STAMP, updatedAt: STAMP, ...(recipeCount === undefined ? {} : { recipeCount }) };
}

/** A recipe's tags, in order, as the API nests them. */
export function tagsOn(recipeId: string, tags: Tag[]): RecipeTag[] {
    return tags.map((counted, orderIndex) => {
        const plain = withoutCount(counted);
        return { recipeId, tagId: plain.id, orderIndex, tag: plain };
    });
}

/** A tag as a recipe or the snapshot has it: without `recipeCount`. */
function withoutCount(tag: Tag): Tag {
    const plain = { ...tag };
    delete plain.recipeCount;
    return plain;
}

/** A shared piece of equipment (3b). */
export function item(name: string): Equipment {
    const id = `50000000-0000-4000-8000-${String(name.length).padStart(4, '0')}${name.slice(0, 8).replace(/\W/g, '0').padEnd(8, '0')}`;
    return { id, name, createdAt: STAMP, updatedAt: STAMP };
}

/** A recipe's equipment lines, as the API nests them. */
export function equipmentOn(recipeId: string, lines: [Equipment, number?, boolean?][]): RecipeEquipment[] {
    return lines.map(([equipment, quantity = 1, optional = false], orderIndex) => ({
        id: `${recipeId}-equipment-${orderIndex}`,
        recipeId,
        equipmentId: equipment.id,
        orderIndex,
        quantity,
        optional,
        equipment,
    }));
}

function line(
    orderIndex: number,
    name: string,
    quantity: number | null,
    unit: string | null,
    extra: { quantityMax?: number; note?: string } = {},
): RecipeIngredient {
    const ingredientId = `10000000-0000-4000-8000-${String(orderIndex).padStart(12, '0')}`;
    return {
        id: `20000000-0000-4000-8000-${String(orderIndex).padStart(12, '0')}`,
        recipeId: BEEF_CHILI_ID,
        ingredientId,
        orderIndex,
        quantity,
        quantityMax: extra.quantityMax ?? null,
        unit,
        note: extra.note ?? null,
        sectionId: null,
        ingredient: { id: ingredientId, name, createdAt: STAMP, updatedAt: STAMP },
    };
}

/** A section of a recipe's method, with steps made from their text (3b). */
export function section(recipeId: string, index: number, name: string, steps: (string | [string, number])[]): RecipeSection {
    const id = `30000000-0000-4000-8000-${recipeId.slice(-6)}${String(index).padStart(6, '0')}`;
    return {
        id,
        recipeId,
        name,
        orderIndex: index,
        steps: steps.map((step, orderIndex) => {
            const [text, timerSeconds] = typeof step === 'string' ? [step, null] : step;
            return { id: `${id.slice(0, -2)}${String(orderIndex).padStart(2, '0')}`, sectionId: id, orderIndex, text, timerSeconds };
        }),
    };
}

export const beefChiliSummary: RecipeSummary = {
    id: BEEF_CHILI_ID,
    name: 'Beef Chili',
    description: 'Chilli con Carne using Beef mince and bacon lardons',
    servings: 2,
    prepTime: 20,
    cookTime: 120,
    createdAt: STAMP,
    updatedAt: STAMP,
    tags: [],
};

export const beefChili: Recipe = {
    ...beefChiliSummary,
    equipment: [],
    sections: [
        section(BEEF_CHILI_ID, 0, 'Method', [
            'Heat some oil and cook the onions.',
            'Add the garlic.',
            'Simmer for at least 20 minutes.',
        ]),
    ],
    recipeIngredients: [
        line(0, 'onion', 1, null, { note: 'diced' }),
        line(1, 'red pepper', 0.5, null, { note: 'diced' }),
        line(2, 'garlic', 1, 'clove', { note: 'chopped' }),
        line(3, 'smoked paprika', 1, 'tsp', { quantityMax: 2 }),
        line(4, 'cayenne pepper', null, null, { note: 'to taste' }),
        line(5, 'beef mince', 500, 'g'),
        line(6, 'sweetcorn', 2, 'can', { note: 'drained' }),
    ],
};

/** Another whole recipe, for a copy with more than one. */
export const lemonDrizzle: Recipe = {
    id: '0c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e',
    name: 'Lemon Drizzle Cake',
    description: null,
    servings: 8,
    prepTime: 15,
    cookTime: 45,
    createdAt: STAMP,
    updatedAt: STAMP,
    sections: [section('0c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e', 0, 'Method', ['Bake.'])],
    recipeIngredients: [],
    tags: [],
    equipment: [],
};

/** A recipe's ETag in the tests: its updatedAt, quoted, as the API happens to make them. */
export function etagOf(recipe: Recipe): string {
    return `"${Date.parse(recipe.updatedAt)}"`;
}

/**
 * What `GET /api/sync` would return for these recipes: their ingredients,
 * tags and equipment, each once, sorted by name, plus any other tags given.
 */
export function snapshotOf(recipes: Recipe[], extraTags: Tag[] = []): Snapshot {
    const byName = <T extends { name: string }>(items: Iterable<T>) => [...items].sort((a, b) => a.name.localeCompare(b.name));
    const ingredients = new Map(recipes.flatMap((recipe) => recipe.recipeIngredients.map((line) => [line.ingredient.id, line.ingredient])));
    const tags = new Map([...recipes.flatMap((recipe) => recipe.tags.map((line) => line.tag)), ...extraTags].map((plain) => [plain.id, plain]));
    const equipment = new Map(recipes.flatMap((recipe) => recipe.equipment.map((line) => [line.equipment.id, line.equipment])));
    return {
        recipes: byName(recipes),
        ingredients: byName(ingredients.values()),
        etags: Object.fromEntries(recipes.map((recipe) => [recipe.id, etagOf(recipe)])),
        tags: byName(tags.values()).map(withoutCount),
        equipment: byName(equipment.values()),
    };
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Store an offline copy of these recipes, made `ageMs` ago. */
export function seedCopy(recipes: Recipe[], ageMs = 0, etag = '"snapshot-1"'): Promise<void> {
    return replaceOfflineCopy(snapshotOf(recipes), etag, Date.now() - ageMs);
}
