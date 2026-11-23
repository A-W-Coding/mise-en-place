/**
 * @module web/src/api/types
 * The shapes the API returns (docs/api.md). Timestamps arrive as ISO strings.
 */

/** A shared ingredient. Names are trimmed and lowercase. */
export interface Ingredient {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

/** One line of a recipe, with its ingredient. `unit` is a canonical symbol, or null for a count. */
export interface RecipeIngredient {
    id: string;
    recipeId: string;
    ingredientId: string;
    orderIndex: number;
    quantity: number | null;
    quantityMax: number | null;
    unit: string | null;
    note: string | null;
    ingredient: Ingredient;
}

/** A recipe as a list returns it: no ingredient lines or instructions (lighter lists, Step 11). */
export interface RecipeSummary {
    id: string;
    name: string;
    description: string | null;
    servings: number;
    /** Minutes. */
    prepTime: number | null;
    /** Minutes. */
    cookTime: number | null;
    createdAt: string;
    updatedAt: string;
}

/** A whole recipe, from `GET /api/recipes/:id`. */
export interface Recipe extends RecipeSummary {
    instructions: string | null;
    recipeIngredients: RecipeIngredient[];
}
