# Database schema (ERD)

The schema in `prisma/schema.prisma`: Phase 1's tables, and Phase 3b's. Phase 1's `Recipe.instructions`, the method as text, became each recipe's "Method" section in 3b, and was then dropped. GitHub draws the diagrams below; in an editor, they need a Mermaid preview. The reasons behind each field are in the technical spec, §2.1 and §2.3.

## Phase 1: recipes, ingredients and lines

```mermaid
erDiagram
    Recipe ||--o{ RecipeIngredient : "has lines (deleted with the recipe)"
    Ingredient ||--o{ RecipeIngredient : "is used by (can't be deleted while used)"

    Recipe {
        String id PK "UUID"
        String name "1-200 characters"
        String description "nullable"
        Int servings "1-1000, default 1"
        Int prepTime "minutes, nullable"
        Int cookTime "minutes, nullable"
        String primaryImageId FK "nullable, unique (3b)"
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
        String sectionId FK "nullable, indexed (3b)"
    }
```

- `PK` is the primary key, `FK` a foreign key, and `UK` a unique column.
- A recipe has any number of lines, and each line uses one ingredient. The same ingredient can appear on several lines of one recipe.
- Deleting a recipe deletes its lines (cascade). Deleting an ingredient fails while any line uses it (restrict); the API returns 409.
- Both `name` columns also have a trigram (GIN) index for fuzzy search: `recipe_name_trgm_idx` and `ingredient_name_trgm_idx`.
- `unit` holds a symbol from `shared/units.ts`, such as `g` or `tbsp`. See [the API reference](api.md#units) for the list.

## Phase 3b: the method, images, tags and equipment

All of these tables exist from Step 20. The method's sections and steps are used from then on; images, tags and equipment come into use in later steps.

```mermaid
erDiagram
    Recipe ||--o{ RecipeSection : "has its method in (deleted with it)"
    RecipeSection ||--o{ Instruction : "has steps (deleted with it)"
    RecipeSection |o--o{ RecipeIngredient : "groups lines (unset if deleted)"
    Recipe ||--o{ Image : "has images (deleted with it)"
    Image |o--o| Recipe : "is the main image of (unset if deleted)"
    Recipe ||--o{ RecipeTag : "is tagged"
    Tag ||--o{ RecipeTag : "tags (removed from every recipe if deleted)"
    Recipe ||--o{ RecipeEquipment : "has equipment lines (deleted with it)"
    Equipment ||--o{ RecipeEquipment : "is used by (can't be deleted while used)"

    RecipeSection {
        String id PK "UUID"
        String recipeId FK "indexed"
        String name "1-100 characters"
        Int orderIndex "set by the server"
    }

    Instruction {
        String id PK "UUID"
        String sectionId FK "indexed"
        Int orderIndex "set by the server"
        String text "1-2000 characters"
        Int timerSeconds "nullable, 1-86400"
    }

    Image {
        String id PK "UUID, and the files' name"
        String recipeId FK "indexed"
        Int orderIndex "upload order"
        Int width "pixels"
        Int height "pixels"
        Int fileSize "bytes"
        DateTime createdAt
    }

    Tag {
        String id PK "UUID"
        String name UK "trimmed, lowercase, 1-50"
        String color "nullable, #rrggbb"
        DateTime createdAt
        DateTime updatedAt
    }

    RecipeTag {
        String recipeId PK "and FK"
        String tagId PK "and FK, indexed"
        Int orderIndex "the list shows the first two"
    }

    Equipment {
        String id PK "UUID"
        String name UK "trimmed, lowercase, 1-100"
        DateTime createdAt
        DateTime updatedAt
    }

    RecipeEquipment {
        String id PK "UUID"
        String recipeId FK "indexed"
        String equipmentId FK "indexed"
        Int orderIndex "set by the server"
        Int quantity "default 1"
        Boolean optional "default false"
    }
```

- Deleting a section deletes its steps, and leaves its lines in no section (`SET NULL`).
- An image's files are on disk, named after its id; there's no path column (spec §6.2).
- Tag and equipment names also have trigram (GIN) indexes, `tag_name_trgm_idx` and `equipment_name_trgm_idx`, for fuzzy search like ingredients.
