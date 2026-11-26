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
 * order; its tags, each with its Tag record, in the recipe's order; its
 * equipment lines, each with its Equipment record, in order; and its images,
 * in upload order (Step 24). `primaryImageId` names the main one.
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
    images: {
        orderBy: { orderIndex: 'asc' },
    },
} as const;

/**
 * The fields of a recipe in a list: everything but its ingredient lines,
 * method, equipment and images, plus its tags, as a whole recipe has them,
 * so the list can show the first two as pills, and its main image's id, for
 * its thumbnail (3b).
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
    primaryImageId: true,
    tags: RECIPE_INCLUDE.tags,
} as const;
