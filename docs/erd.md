# Database schema (ERD)

The Phase 1 schema, from `prisma/schema.prisma`. GitHub draws the diagram below; in an editor, it needs a Mermaid preview. The reasons behind each field are in the technical spec, §2.1.

```mermaid
erDiagram
    Recipe ||--o{ RecipeIngredient : "has lines (deleted with the recipe)"
    Ingredient ||--o{ RecipeIngredient : "is used by (can't be deleted while used)"

    Recipe {
        String id PK "UUID"
        String name "1-200 characters"
        String description "nullable"
        Int servings "default 1"
        Int prepTime "minutes, nullable"
        Int cookTime "minutes, nullable"
        String instructions "nullable"
        DateTime createdAt
        DateTime updatedAt "set on every PATCH"
    }

    Ingredient {
        String id PK "UUID"
        String name UK "trimmed, lowercase"
        DateTime createdAt
        DateTime updatedAt
    }

    RecipeIngredient {
        String id PK "UUID"
        String recipeId FK "indexed"
        String ingredientId FK "indexed"
        Int orderIndex "position, set by the server"
        Float quantity "nullable: to taste"
        Float quantityMax "nullable: top of a range"
        String unit "nullable: a count; else a unit symbol"
        String note "nullable: preparation"
    }
```

- `PK` is the primary key, `FK` a foreign key, and `UK` a unique column.
- A recipe has any number of lines, and each line uses one ingredient. The same ingredient can appear on several lines of one recipe.
- Deleting a recipe deletes its lines (cascade). Deleting an ingredient fails while any line uses it (restrict); the API returns 409.
- Both `name` columns also have a trigram (GIN) index for fuzzy search: `recipe_name_trgm_idx` and `ingredient_name_trgm_idx`.
- `unit` holds a symbol from `src/units.ts`, such as `g` or `tbsp`. See [the API reference](api.md#units) for the list.
