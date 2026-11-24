/**
 * @module prisma/seeds/base-seed
 * Base seed data for the mise-en-place recipe database.
 *
 * Seeds one complete recipe ("Beef Chili") with 12 ingredients, 10 ordered
 * ingredient lines (covering a count with no unit, a quantity range, a
 * "to taste" line with no quantity, and preparation notes), and a method of
 * 14 steps in one section, "Method" (3b).
 * Used by tests to establish a known starting state, and as sample data
 * during local development. Run it from the command line with `run.ts`.
 */

import type { Database } from '../client.js';
import { assertSafeDatabase, TEST_OR_DEV } from '../utils/safe-database.js';

/** Raw ingredient names to seed (stored lowercase per API convention). */
const SEED_INGREDIENTS = [
    { name: 'onion' }, { name: 'garlic' }, { name: 'beef mince' },
    { name: 'lardons' }, { name: 'sweetcorn' }, { name: 'smoked paprika' },
    { name: 'cayenne pepper' }, { name: 'cumin' }, { name: 'red pepper' },
    { name: 'beef stock' }, { name: 'kidney beans' }, { name: 'tomato puree' },
];

/** Beef Chili's method: the steps of its one section, "Method". */
const BEEF_CHILI_STEPS = [
    'Put the Beef stock pot in a jug and add the correct amount of boiling water.',
    'Heat some oil in a suitable frying pan (medium heat). Add the onions and pepper and cook for 10 minutes.',
    'Add the garlic and cook for 2 minutes.',
    'Add the bacon/lardons and cook for 4 minutes.',
    'Add the chilli con carne mix and cook for 2 minutes.',
    'Add the mince and cook until browned.',
    'Add the tomato puree and the beef stock. Bring to the boil and then simmer.',
    'Allow to simmer for at least 20 minutes.',
    'Taste and season.',
    'Add ketchup for sweetness if desired.',
    'Reheat gently if starting from cold.',
    'Drain and add sweet corn.',
    'Turn up the heat to boil off remaining liquid.',
    'Stop when you have the desired consistency.',
];

/** One ingredient line as written in the seed. `ingredient` is a name from SEED_INGREDIENTS. */
interface SeedLine {
    ingredient: string;
    quantity: number | null;
    quantityMax?: number;
    unit: string | null;
    note?: string;
}

/**
 * Beef Chili's ingredient lines, in the order the method uses them.
 * Units are canonical symbols from the D2 list; a null unit means a count.
 */
const BEEF_CHILI_LINES: SeedLine[] = [
    { ingredient: 'onion',          quantity: 1,    unit: null,    note: 'diced' },
    { ingredient: 'red pepper',     quantity: 0.5,  unit: null,    note: 'diced' },
    { ingredient: 'garlic',         quantity: 1,    unit: 'clove', note: 'chopped' },
    { ingredient: 'lardons',        quantity: 100,  unit: 'g' },
    { ingredient: 'smoked paprika', quantity: 1,    quantityMax: 2, unit: 'tsp' },
    { ingredient: 'cayenne pepper', quantity: null, unit: null,    note: 'to taste' },
    { ingredient: 'beef mince',     quantity: 500,  unit: 'g' },
    { ingredient: 'tomato puree',   quantity: 2,    unit: 'tbsp' },
    { ingredient: 'beef stock',     quantity: 1,    unit: null,    note: 'stock cube, made up with 400 ml boiling water' },
    { ingredient: 'sweetcorn',      quantity: 1,    unit: 'can',   note: 'drained' },
];

/**
 * Seed the database with base data.
 *
 * Refuses to run unless DATABASE_URL names a `_test` or `_dev` database.
 *
 * Execution order:
 *  1. Clear all existing rows (junction → parent).
 *  2. Bulk-create ingredients.
 *  3. Create the Beef Chili recipe.
 *  4. Link ingredients to the recipe via RecipeIngredient.
 *
 * @param prisma - The shared Prisma client (`prisma/client.ts`).
 */
export async function seed(prisma: Database): Promise<void> {
    assertSafeDatabase(TEST_OR_DEV);

    // 1. Clear existing data (safe order; a recipe takes its sections and steps with it)
    await prisma.recipeIngredient.deleteMany({});
    await prisma.recipe.deleteMany({});
    await prisma.ingredient.deleteMany({});
    await prisma.tag.deleteMany({});
    await prisma.equipment.deleteMany({});

    // 2. Seed ingredients
    await prisma.ingredient.createMany({ data: SEED_INGREDIENTS });

    // Build a lookup map: ingredient name → id
    const allIngredients = await prisma.ingredient.findMany();
    const idOf = new Map(allIngredients.map((i) => [i.name, i.id]));

    // 3. Seed the recipe
    const beefChili = await prisma.recipe.create({
        data: {
            name: 'Beef Chili',
            description: 'Chilli con Carne using Beef mince and bacon lardons',
            servings: 2,
            prepTime: 20,
            cookTime: 120,
            sections: {
                create: [
                    {
                        name: 'Method',
                        orderIndex: 0,
                        steps: { create: BEEF_CHILI_STEPS.map((text, orderIndex) => ({ text, orderIndex })) },
                    },
                ],
            },
        },
    });

    // 4. Link ingredients to the recipe, numbering the lines in order.
    // An unknown name throws rather than being skipped, so a typo here
    // can't silently drop a line from the test data.
    const lines = BEEF_CHILI_LINES.map((line, orderIndex) => {
        const ingredientId = idOf.get(line.ingredient);
        if (!ingredientId) {
            throw new Error(`Seed line names an unknown ingredient: "${line.ingredient}"`);
        }
        return {
            recipeId: beefChili.id,
            ingredientId,
            orderIndex,
            quantity: line.quantity,
            quantityMax: line.quantityMax ?? null,
            unit: line.unit,
            note: line.note ?? null,
        };
    });

    await prisma.recipeIngredient.createMany({ data: lines });
}