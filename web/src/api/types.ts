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
    /** The section it's grouped under, or none (3b). */
    sectionId: string | null;
    ingredient: Ingredient;
}

/** A shared tag (3b). Names are trimmed and lowercase; `color` is `#rrggbb` or none. */
export interface Tag {
    id: string;
    name: string;
    color: string | null;
    createdAt: string;
    updatedAt: string;
    /** How many recipes have it: from `/api/tags` only, not inside a recipe or the snapshot. */
    recipeCount?: number;
}

/** One of a recipe's tags, in the recipe's own order (3b). */
export interface RecipeTag {
    recipeId: string;
    tagId: string;
    orderIndex: number;
    tag: Tag;
}

/** A shared piece of equipment (3b). Names are trimmed and lowercase. */
export interface Equipment {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

/** One thing a recipe needs, how many, and whether it works without it (3b). */
export interface RecipeEquipment {
    id: string;
    recipeId: string;
    equipmentId: string;
    orderIndex: number;
    quantity: number;
    optional: boolean;
    equipment: Equipment;
}

/** One step of a section's method (3b). */
export interface Step {
    id: string;
    sectionId: string;
    orderIndex: number;
    text: string;
    /** A timer cooking mode can start for this step, in seconds. */
    timerSeconds: number | null;
}

/** A part of a recipe's method, such as "Sauce", with its steps in order (3b). */
export interface RecipeSection {
    id: string;
    recipeId: string;
    name: string;
    orderIndex: number;
    steps: Step[];
}

/** A recipe as a list returns it: no ingredient lines, method or equipment (lighter lists, Step 11), but its tags (3b). */
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
    /** In the recipe's order: the list shows the first two (3b). */
    tags: RecipeTag[];
}

/** A whole recipe, from `GET /api/recipes/:id`. From 3b, its method is `sections`, and it has equipment lines. */
export interface Recipe extends RecipeSummary {
    sections: RecipeSection[];
    recipeIngredients: RecipeIngredient[];
    equipment: RecipeEquipment[];
}
