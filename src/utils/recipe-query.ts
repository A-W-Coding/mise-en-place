/**
 * @module src/utils/recipe-query
 * How a whole recipe is read from the database.
 *
 * Shared by the recipe routes and the snapshot (`GET /api/sync`), so a recipe
 * in the snapshot is exactly what `GET /api/recipes/:id` returns.
 */

/**
 * The Prisma `include` for a whole recipe: its ingredient lines in recipe
 * order, each with its Ingredient record, so a client needs one request.
 */
export const RECIPE_INCLUDE = {
    recipeIngredients: {
        include: { ingredient: true },
        orderBy: { orderIndex: 'asc' },
    },
} as const;
