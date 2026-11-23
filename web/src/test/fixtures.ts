/**
 * @module web/src/test/fixtures
 * Recipes for the component tests, shaped like the API's responses.
 */

import type { Recipe, RecipeIngredient, RecipeSummary } from '../api/types';

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
        ...overrides,
    };
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
        ingredient: { id: ingredientId, name, createdAt: STAMP, updatedAt: STAMP },
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
};

export const beefChili: Recipe = {
    ...beefChiliSummary,
    instructions: '1. Heat some oil and cook the onions.\n2. Add the garlic.\n\n3. Simmer for at least 20 minutes.',
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
