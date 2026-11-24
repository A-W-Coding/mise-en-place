/**
 * @module src/utils/recipe-query
 * How a whole recipe is read from the database.
 *
 * Shared by the recipe routes and the snapshot (`GET /api/sync`), so a recipe
 * in the snapshot is exactly what `GET /api/recipes/:id` returns.
 */

/**
 * The Prisma `include` for a whole recipe, so a client needs one request:
 * its ingredient lines in recipe order, each with its Ingredient record and
 * `sectionId`, and from 3b its method's sections, each with its steps, in
 * order; its tags, each with its Tag record, in the recipe's order; and its
 * equipment lines, each with its Equipment record, in order.
 */
export const RECIPE_INCLUDE = {
    recipeIngredients: {
        include: { ingredient: true },
        orderBy: { orderIndex: 'asc' },
    },
    sections: {
        include: { steps: { orderBy: { orderIndex: 'asc' } } },
        orderBy: { orderIndex: 'asc' },
    },
    tags: {
        include: { tag: true },
        orderBy: { orderIndex: 'asc' },
    },
    equipment: {
        include: { equipment: true },
        orderBy: { orderIndex: 'asc' },
    },
} as const;

/**
 * The fields of a recipe in a list: everything but its ingredient lines,
 * method and equipment, plus its tags, as a whole recipe has them, so the
 * list can show the first two as pills (3b). Step 24 adds its main image.
 */
export const RECIPE_SUMMARY_SELECT = {
    id: true,
    name: true,
    description: true,
    servings: true,
    prepTime: true,
    cookTime: true,
    createdAt: true,
    updatedAt: true,
    tags: RECIPE_INCLUDE.tags,
} as const;
