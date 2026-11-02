/**
 * @module prisma/seeds/base-seed
 * Base seed data for the mise-en-place recipe database.
 *
 * Seeds one complete recipe ("Beef Chili") with 12 ingredients and
 * 10 ordered ingredient lines, covering a count with no unit, a quantity
 * range, a "to taste" line with no quantity, and preparation notes.
 * Used by tests to establish a known starting state, and as sample data
 * during local development. Run it from the command line with `run.ts`.
 */

import { PrismaClient } from '@prisma/client';
import { assertSafeDatabase, TEST_OR_DEV } from '../utils/safe-database.js';

/** Raw ingredient names to seed (stored lowercase per API convention). */
const SEED_INGREDIENTS = [
    { name: 'onion' }, { name: 'garlic' }, { name: 'beef mince' },
    { name: 'lardons' }, { name: 'sweetcorn' }, { name: 'smoked paprika' },
    { name: 'cayenne pepper' }, { name: 'cumin' }, { name: 'red pepper' },
    { name: 'beef stock' }, { name: 'kidney beans' }, { name: 'tomato puree' },
];

/** Beef Chili instruction text. */
const BEEF_CHILI_INSTRUCTIONS = [
    '1. Put the Beef stock pot in a jug and add the correct amount of boiling water.',
    '2. Heat some oil in a suitable frying pan (medium heat). Add the onions and pepper and cook for 10 minutes.',
    '3. Add the garlic and cook for 2 minutes.',
    '4. Add the bacon/lardons and cook for 4 minutes.',
    '5. Add the chilli con carne mix and cook for 2 minutes.',
    '6. Add the mince and cook until browned.',
    '7. Add the tomato puree and the beef stock. Bring to the boil and then simmer.',
    '8. Allow to simmer for at least 20 minutes.',
    '9. Taste and season.',
    '10. Add ketchup for sweetness if desired.',
    '11. Reheat gently if starting from cold.',
    '12. Drain and add sweet corn.',
    '13. Turn up the heat to boil off remaining liquid.',
    '14. Stop when you have the desired consistency.',
].join('\n');

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
 * @param prisma - PrismaClient instance to operate on.
 */
export async function seed(prisma: PrismaClient): Promise<void> {
    assertSafeDatabase(TEST_OR_DEV);

    // 1. Clear existing data (safe order)
    await prisma.recipeIngredient.deleteMany({});
    await prisma.recipe.deleteMany({});
    await prisma.ingredient.deleteMany({});

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
            instructions: BEEF_CHILI_INSTRUCTIONS,
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