/**
 * @module prisma/seeds/base-seed
 * Base seed data for the mise-en-place recipe database.
 *
 * Seeds one complete recipe ("Beef Chili") with 12 ingredients and
 * 8 recipe-ingredient links. Used by tests to establish a known
 * starting state, and as sample data during local development.
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

    // 4. Link ingredients to the recipe
    const recipeIngredientsLinks = [
        { recipeId: beefChili.id, ingredientId: idOf.get('beef mince'),   quantity: 500, unit: 'g' },
        { recipeId: beefChili.id, ingredientId: idOf.get('lardons'),      quantity: 100, unit: 'g' },
        { recipeId: beefChili.id, ingredientId: idOf.get('garlic'),       quantity: 1,   unit: 'clove - chopped' },
        { recipeId: beefChili.id, ingredientId: idOf.get('sweetcorn'),    quantity: 1,   unit: 'tin' },
        { recipeId: beefChili.id, ingredientId: idOf.get('tomato puree'), quantity: 2,   unit: 'tbsp' },
        { recipeId: beefChili.id, ingredientId: idOf.get('onion'),        quantity: 1,   unit: 'Diced' },
        { recipeId: beefChili.id, ingredientId: idOf.get('red pepper'),   quantity: 0.5, unit: 'Diced' },
        { recipeId: beefChili.id, ingredientId: idOf.get('beef stock'),   quantity: 1,   unit: 'stock cube in 400ml of water' },
    ];

    // Type-predicate filter ensures only rows with resolved IDs reach Prisma
    const validLinks = recipeIngredientsLinks.filter(
        (link): link is { recipeId: string; ingredientId: string; quantity: number; unit: string } =>
            link.ingredientId !== undefined
    );

    await prisma.recipeIngredient.createMany({ data: validLinks });
}