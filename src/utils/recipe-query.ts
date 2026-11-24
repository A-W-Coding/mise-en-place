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
 * order.
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
} as const;
