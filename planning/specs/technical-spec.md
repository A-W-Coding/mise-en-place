# Recipe App Technical Specification
 
## 1. Introduction
 
This technical specification details the implementation approach for the Recipe App, with a particular focus on the database schema, API design, testing strategy, and deployment pipeline. The document is structured to support a six-phase development approach, allowing for incremental implementation while maintaining focus on professional development practices.
 
## 2. Database Schema Design
 
The database schema will evolve through six distinct phases, each building upon the previous one to add functionality while maintaining backward compatibility.
 
### 2.1 Phase 1: Foundation (Backend API)

#### Core Entities

The Phase 1 schema covers basic recipe management: recipes, a shared list of ingredients, and the ingredient lines that connect them. It was finalised in one migration (`phase1_ingredient_model`) before any real data existed, so no field needed a default or a backfill.

##### Recipe Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the recipe |
| name | String | Required, 1–200 characters (API) | Recipe name, stored trimmed |
| description | String | Optional | Recipe description |
| servings | Integer | Default: 1, at least 1 (API) | Number of servings the recipe produces |
| prepTime | Integer | Optional, 0 or more (API) | Preparation time in minutes |
| cookTime | Integer | Optional, 0 or more (API) | Cooking time in minutes |
| instructions | Text | Optional | Plain-text instructions (structured instructions arrive in Phase 3) |
| createdAt | DateTime | Auto: current time | When the recipe was created |
| updatedAt | DateTime | Auto: on update, and set explicitly by every PATCH | When the recipe, or any of its lines, last changed |

Indexes: a GIN trigram index on `name` (`recipe_name_trgm_idx`) for fuzzy search.

##### Ingredient Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the ingredient |
| name | String | Required, **Unique**, 1–100 characters (API) | Ingredient name, stored trimmed and lowercase |
| createdAt | DateTime | Auto: current time | When the ingredient was created |
| updatedAt | DateTime | Auto: update | When the ingredient was last renamed |

Indexes: the unique index on `name` (`Ingredient_name_key`), and a GIN trigram index on `name` (`ingredient_name_trgm_idx`) for fuzzy search.

##### RecipeIngredient Entity (an ingredient line)

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the line |
| recipeId | UUID | Foreign Key, Required, Indexed | References Recipe |
| ingredientId | UUID | Foreign Key, Required, Indexed | References Ingredient |
| orderIndex | Integer | Required | Position of the line in the recipe, starting at 0. Set by the server, never by clients |
| quantity | Float | Optional, greater than 0 (API) | Amount of the ingredient. Null means "to taste" or unspecified |
| quantityMax | Float | Optional, at least `quantity` (API) | Upper end of a range, as in "2–3 cloves". Only allowed when `quantity` is set |
| unit | String | Optional | Canonical unit symbol, such as `g` or `tbsp`. Null means a count, as in "3 eggs" |
| note | String | Optional, up to 200 characters (API) | Preparation, such as "finely diced" |

*Note: constraints marked (API) are enforced by the request schemas in `src/schemas/`, not by the database.*

#### Phase 1 Entity Relationships

| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | RecipeIngredient | The recipe's ingredient lines, in `orderIndex` order |
| Ingredient | One-to-Many | RecipeIngredient | Lines that use this ingredient |
| RecipeIngredient | Many-to-One | Recipe | Parent recipe (deleting the recipe deletes its lines) |
| RecipeIngredient | Many-to-One | Ingredient | Referenced ingredient (can't be deleted while in use) |

The same ingredient may appear on more than one line of a recipe, so there is deliberately no unique constraint on `(recipeId, ingredientId)`: butter for the base and butter for the topping are two lines.

#### Phase 1 Schema Design Principles

1. **UUID Primary Keys**

   **Implementation:**
   ```prisma
   model Recipe {
     id   String @id @default(uuid())
     name String
     // other fields
   }
   ```

   **Rationale:** UUIDs were chosen over auto-incrementing integers because they can be generated anywhere:
   - A client can create a record offline and choose its id, with no risk of colliding with ids made on another device. This only works once the API accepts client-generated ids, which is a Phase 3 decision (F3).
   - Records keep the same id when data is synced, exported or moved between databases.

   UUIDs are **not** a security measure here. `GET /api/recipes` lists every id, and the API has no authentication; access is controlled by the network (localhost in Phase 1, the Tailscale network from Phase 2).

2. **Unique, Normalised Ingredient Names**

   **Implementation:**
   ```prisma
   model Ingredient {
     id   String @id @default(uuid())
     name String @unique
   }
   ```

   ```typescript
   // src/schemas/ingredients.ts: applied to every create and rename
   name: z.string().trim().toLowerCase().min(1).max(100)
   ```

   **Rationale:** an ingredient list is only useful if each ingredient appears once.
   - The API normalises names, so "Onion", " onion " and "ONION" are all stored as `onion`.
   - The database's unique constraint is what actually prevents duplicates. Checking for an existing name before inserting would leave a race: two requests could both find no match and both insert. Instead the insert itself fails, Prisma reports `P2002`, and the API returns 409.
   - Synonyms such as "scallion" and "spring onion" remain separate ingredients. A merge feature may come later.

3. **Ordered Lines with Notes**

   **Implementation:** each line has an `orderIndex` and an optional `note`. Clients send lines as an array, and the server sets `orderIndex` from each line's position. Responses return lines sorted by `orderIndex`.

   **Rationale:** a recipe's ingredient list has a natural order, usually the order the method uses them, and a database returns rows in no guaranteed order unless told to. Clients never send `orderIndex`, so it can't be wrong or duplicated. The `note` keeps preparation out of the ingredient name, so "finely diced onion" is the ingredient `onion` with the note "finely diced", not a new ingredient.

4. **Nullable Quantity and Unit, with Ranges**

   **Implementation:**
   ```prisma
   quantity    Float?  // null means "to taste" or unspecified
   quantityMax Float?  // upper bound of a range, as in "2–3"
   unit        String? // canonical symbol; null means a count
   ```

   **Rationale:** real recipes don't all fit "number plus unit":
   - "Salt, to taste" has no quantity. Storing 0 would claim the recipe uses none.
   - "3 eggs" has no unit. Requiring one forces something meaningless like "whole".
   - "2–3 cloves of garlic" is a range, stored as `quantity` 2 and `quantityMax` 3.

5. **Canonical Units, Defined in Code (D2)**

   **Implementation:** `src/units.ts` lists every unit as a canonical symbol with aliases, for example `g` (gram, grams, gr) and `tbsp` (tablespoon, tablespoons, tbs). The API converts whatever the client sends to the symbol, ignoring case, surrounding spaces and a trailing full stop, and rejects an unknown unit with 400 and the list of allowed units. The database stores only the symbol.

   **Rationale:**
   - "g", "gram" and "grams" must be stored the same way, or quantities can never be added up, for example on a shopping list.
   - The list lives in code rather than a database enum, so adding a unit is a one-line change, not a migration.
   - The module has no server dependencies, so the Phase 3 client can use the same list. Each unit records its dimension (mass, volume or other), ready for conversion factors in Phase 6.

6. **Cascade and Restrict Deletes**

   **Implementation:**
   ```prisma
   recipe     Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)
   ingredient Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Restrict)
   ```

   **Rationale:**
   - **Recipe → RecipeIngredient: Cascade.** Deleting a recipe deletes its lines, which mean nothing without it.
   - **Ingredient → RecipeIngredient: Restrict.** Deleting an ingredient that a recipe uses fails, and the API returns 409. This protects shared reference data from accidental loss.

7. **Indexes**

   **Implementation:**
   ```prisma
   @@index([recipeId])
   @@index([ingredientId])
   @@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "recipe_name_trgm_idx")
   ```

   **Rationale:**
   - PostgreSQL doesn't index foreign keys automatically. Loading a recipe's lines, and checking whether an ingredient is in use, both look up lines by these columns.
   - The trigram (GIN) indexes support fuzzy name search. The `pg_trgm` extension is enabled in a migration, so every environment gets it.
   - The trigram indexes are declared in the schema, with `map:` keeping the names their original migration gave them. An index that exists only in migration SQL looks like drift to Prisma, and every later `prisma migrate dev` would try to drop it.

8. **Deferred Features**

   These are documented but deferred beyond Phase 1:
   - **Soft delete** (`deletedAt`): when recipe restoration, or sync of deletions, is needed (F2, D8)
   - **Version tracking** (`previousVersion`): when undo or history is needed
   - **Section links on lines** (`sectionId`): Phase 3, for groupings like "for the sauce"
   - **Unit conversion**: Phase 6, using per-ingredient densities to convert between volume and weight

#### Current Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Recipe {
  id           String   @id @default(uuid())
  name         String
  description  String?
  servings     Int      @default(1)
  prepTime     Int? // minutes
  cookTime     Int? // minutes
  instructions String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  recipeIngredients RecipeIngredient[]

  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "recipe_name_trgm_idx")
}

model RecipeIngredient {
  id           String  @id @default(uuid())
  recipeId     String
  ingredientId String
  orderIndex   Int // set by the server from the line's position in the array
  quantity     Float? // null means "to taste" or unspecified
  quantityMax  Float? // upper bound of a range, as in "2–3"
  unit         String? // canonical symbol from the units module; null means a count
  note         String? // preparation, e.g. "finely diced"

  recipe     Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  ingredient Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Restrict)

  @@index([recipeId])
  @@index([ingredientId])
}

model Ingredient {
  id        String   @id @default(uuid())
  name      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  recipeIngredients RecipeIngredient[]

  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "ingredient_name_trgm_idx")
}
```
 
### 2.2 Phase 2: Pi Deployment (Local Network)
 
Phase 2 focuses on deployment rather than schema changes. The Phase 1 schema is deployed to the Raspberry Pi with PostgreSQL running in Docker.
 
**Infrastructure Focus:**
- Docker containerization
- PostgreSQL on Raspberry Pi
- Backup automation
- Health monitoring
 
No schema changes in this phase.
 
### 2.3 Phase 3: Desktop UI
 
Phase 3 expands the schema to support the desktop user interface with structured instructions, images, tags, and equipment.
 
#### Additional Entities
 
##### RecipeSection Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for section |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| name | String | Required | Section name (e.g., "Sauce", "Main") |
| orderIndex | Integer | Required | Position within recipe |
 
##### Instruction Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for instruction |
| sectionId | UUID | Foreign Key, Required | References RecipeSection |
| stepNumber | Integer | Required | Order within section |
| text | Text | Required | Instruction text |
| stepType | String | Default: "Cooking" | Type of instruction step |
| timerLength | Integer | Optional | Timer duration in seconds |
 
##### Image Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for image |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| filePath | String | Required | Path to image file |
| isPrimary | Boolean | Default: false | Whether this is the main image |
| width | Integer | Optional | Image width in pixels |
| height | Integer | Optional | Image height in pixels |
| fileSize | Integer | Optional | File size in bytes |
| uploadedAt | DateTime | Auto: current time | When image was uploaded |
 
##### Tag Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for tag |
| name | String | Unique, Required | Tag name |
| color | String | Optional | HEX color code for visual representation |
 
##### Equipment Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for equipment |
| name | String | Unique, Required | Equipment name |
| description | Text | Optional | Equipment description |
 
##### RecipeEquipment Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for recipe-equipment relation |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| equipmentId | UUID | Foreign Key, Required | References Equipment |
| optional | Boolean | Default: false | Whether equipment is optional |
| quantity | Integer | Default: 1 | Number of equipment items needed |
 
##### RecipeLink Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for recipe link |
| sourceRecipeId | UUID | Foreign Key, Required | References source Recipe |
| linkedRecipeId | UUID | Foreign Key, Required | References linked Recipe |
| linkType | String | Required | Relationship type (e.g., "component", "variation") |
| notes | Text | Optional | Notes about the recipe link |
 
#### Phase 3 Entity Relationships
 
| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | RecipeSection | Sections within recipe |
| Recipe | One-to-Many | Image | Images of recipe |
| Recipe | Many-to-Many | Tag | Tags applied to recipe |
| Recipe | One-to-Many | RecipeEquipment | Equipment used in recipe |
| Recipe | One-to-Many | RecipeLink (as source) | Links to other recipes |
| Recipe | One-to-Many | RecipeLink (as linked) | Links from other recipes |
| RecipeSection | One-to-Many | Instruction | Instructions within section |
| Tag | Many-to-Many | Recipe | Recipes with this tag |
| Equipment | One-to-Many | RecipeEquipment | Recipes using this equipment |
 
#### Phase 3 Schema Enhancements
 
1. **Structured Instructions**
   - Replace simple text instructions with hierarchical sections and steps
   - Support timing information and instruction types
   - Allow more complex recipe organization
 
2. **Image Management**
   - Store image metadata in the database
   - Support multiple images per recipe with primary image designation
   - Track image dimensions and file size for optimization
 
3. **Tagging System**
   - Implement flexible categorization through tags
   - Support colored tags for visual organization
   - Allow filtering and searching by tags
 
### 2.4 Phase 4: Pi Deployment (Global Access)
 
Phase 4 focuses on remote access rather than schema changes.
 
**Infrastructure Focus:**
- VPN configuration (Tailscale or similar)
- Security hardening
- Performance optimization for remote access
 
No schema changes in this phase.
 
### 2.5 Phase 5: Mobile UI
 
Phase 5 may introduce minor schema additions to support mobile-specific features.
 
**Potential Additions:**
- User preferences for display settings
- Offline sync metadata
- Push notification tokens
 
Schema details to be determined based on mobile implementation approach.
 
### 2.6 Phase 6: Enhanced Features
 
Phase 6 adds advanced functionality including meal planning, shopping lists, and external API integration.
 
#### Advanced Functionality Entities
 
##### MealPlan Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for meal plan |
| name | String | Required | Meal plan name |
| startDate | DateTime | Required | Start date of meal plan |
| endDate | DateTime | Required | End date of meal plan |
| createdAt | DateTime | Auto: current time | When meal plan was created |
| updatedAt | DateTime | Auto: update | When meal plan was last updated |
 
##### MealPlanEntry Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for meal plan entry |
| mealPlanId | UUID | Foreign Key, Required | References MealPlan |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| date | DateTime | Required | Date of planned meal |
| mealType | String | Required | Meal type (breakfast, lunch, dinner, snack) |
| servings | Integer | Default: 1 | Number of servings |
| notes | Text | Optional | Notes about the meal |
 
##### ShoppingList Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for shopping list |
| name | String | Required | Shopping list name |
| isActive | Boolean | Default: true | Whether list is active |
| notes | Text | Optional | Notes about the shopping list |
| createdAt | DateTime | Auto: current time | When list was created |
| updatedAt | DateTime | Auto: update | When list was last updated |
 
##### ShoppingListItem Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for shopping list item |
| shoppingListId | UUID | Foreign Key, Required | References ShoppingList |
| ingredientId | UUID | Foreign Key, Optional | References Ingredient |
| customItem | String | Optional | Custom item not in ingredient database |
| quantity | Float | Optional | Amount needed |
| unit | String | Optional | Unit of measurement |
| isChecked | Boolean | Default: false | Whether item has been checked off |
| notes | Text | Optional | Notes about the item |
 
##### NutritionalInfo Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for nutritional info |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| calories | Float | Optional | Calories per serving |
| protein | Float | Optional | Protein content in grams |
| carbs | Float | Optional | Carbohydrate content in grams |
| fat | Float | Optional | Fat content in grams |
| fiber | Float | Optional | Fiber content in grams |
| sugar | Float | Optional | Sugar content in grams |
| sodium | Float | Optional | Sodium content in milligrams |
| source | String | Default: "calculated" | Source of nutritional data ("api" or "calculated") |
| lastUpdated | DateTime | Auto: current time | When data was last updated |
| cacheExpiresAt | DateTime | Optional | When to consider refreshing |
| externalData | JSON | Optional | Stores complete external API response |
 
#### Phase 6 Entity Relationships
 
| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | MealPlanEntry | Meal plan entries using this recipe |
| Recipe | One-to-One | NutritionalInfo | Nutritional information for recipe |
| MealPlan | One-to-Many | MealPlanEntry | Entries in this meal plan |
| ShoppingList | One-to-Many | ShoppingListItem | Items in this shopping list |
| Ingredient | One-to-Many | ShoppingListItem | Shopping list items referencing this ingredient |
 
## 3. API Architecture
 
The API follows RESTful principles and is implemented using Express.js with TypeScript.
 
### 3.1 API Design Principles

1. **Consistency**
   - RESTful URLs under `/api`, with JSON request and response bodies
   - One error shape everywhere: `{ "error": "<message>" }`, plus `fields` for validation errors (see §3.2)
   - Status codes mean the same thing on every endpoint (see the error table in §3.2)

2. **Simplicity**
   - No API versioning (single-user application)
   - Straightforward endpoint structure
   - Query parameters for searching and paging

3. **Validation at the Edge (D1)**

   **Implementation:** every request body and list query is parsed by a strict Zod schema in `src/schemas/` before any database call.
   ```typescript
   const body = parseOr400(createRecipeSchema, req.body, res);
   if (body === null) return; // 400 already sent, with one message per field
   ```

   **Rationale:**
   - One schema gives the validation rules, the TypeScript type and the normalisation (trimming, lowercase ingredient names, canonical units) in one place.
   - The schemas are strict: an unknown field is a 400. That allowlist is what stops a client from setting server-owned fields such as `id`, `createdAt` or `orderIndex` (S3).

4. **Performance**
   - Every list endpoint is paginated, with a stable order, so the response size is bounded however many recipes there are
   - Foreign keys and searched names are indexed (§2.1)

5. **Search Strategy**

   **Implementation:**
   ```
   GET /api/recipes?search=pasta
   GET /api/ingredients?search=onion
   ```

   A single `search` parameter matches names using PostgreSQL's `pg_trgm` trigram similarity (`word_similarity` above 0.3) or a case-insensitive substring match (`ILIKE`), ranked best first. Trigrams catch typos such as "beff" for "Beef Chili"; the substring match catches short exact fragments that score low on similarity.

   **Rationale:** one parameter keeps the API simple and lets the server choose which fields to search. More specific filters, such as `?tag=italian`, can be added later. The term is trimmed and limited to 100 characters, and `%`, `_` and `\` are escaped, so they match literally rather than as wildcards. All raw SQL goes through Prisma's tagged-template `$queryRaw`, which sends every value as a bound parameter.

6. **Access Control (S1)**

   There is no authentication. Access is controlled by the network: the API listens on localhost in development and is reachable only over Tailscale from Phase 2. Browsers may call it cross-origin only from the origins listed in `CORS_ORIGINS`; by default, none.
 
### 3.2 API Endpoints by Phase
 
#### Phase 1: Foundation

| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Health | GET | `/api/health` | Checks the database with `SELECT 1`: 200 `{ "status": "ok" }`, or 503 `{ "status": "error" }` |
| Recipes | GET | `/api/recipes` | List recipes, paginated, with optional fuzzy search |
| Recipes | GET | `/api/recipes/:id` | Get a recipe with its ingredient lines |
| Recipes | POST | `/api/recipes` | Create a recipe, optionally with its lines |
| Recipes | PATCH | `/api/recipes/:id` | Update a recipe; an `ingredients` array replaces every line |
| Recipes | DELETE | `/api/recipes/:id` | Delete a recipe (its lines are deleted too) |
| Ingredients | GET | `/api/ingredients` | List ingredients, paginated, with optional fuzzy search |
| Ingredients | GET | `/api/ingredients/:id` | Get an ingredient |
| Ingredients | POST | `/api/ingredients` | Create an ingredient (name normalised; 409 if it exists) |
| Ingredients | PATCH | `/api/ingredients/:id` | Rename an ingredient (409 if the new name exists) |
| Ingredients | DELETE | `/api/ingredients/:id` | Delete an ingredient (409 while a recipe uses it) |

Recipe responses always include `recipeIngredients`, each with its `ingredient`, sorted by `orderIndex`.

##### Pagination and Ordering (D6)

| Parameter | Default | Rules |
|-----------|---------|-------|
| `limit` | 50 | Whole number from 0 to 100 |
| `offset` | 0 | Whole number, 0 or more |
| `search` | none | One string of up to 100 characters after trimming; blank means no search |

- The response body stays a plain JSON array. The total number of items (or of search matches) across all pages is in the `X-Total-Count` response header. Allowed CORS origins may read that header.
- Plain lists are ordered by name, then id. Search results are ordered by rank, then name, then id. The id tie-break means pages never overlap or skip an item.
- Each parameter must appear once. A repeated or unknown parameter is a 400, so a misspelling such as `?serach=` fails instead of returning an unfiltered list.

**Rationale:** keeping the body an array meant no existing client had to change. An envelope such as `{ items, total }` was the alternative (D6).

##### PATCH Semantics

`PATCH /api/recipes/:id` changes only the fields present in the body. For `ingredients`:

| `ingredients` in the body | Effect on the lines |
|---------------------------|---------------------|
| Absent | Left untouched |
| An array | Every line is replaced by the array, in its order, in one atomic nested write (`deleteMany` plus `create`) |
| `[]` | Every line is removed |

Every PATCH sets the recipe's `updatedAt` explicitly. Prisma's automatic `@updatedAt` doesn't change when only the lines change, and sync relies on the timestamp moving whenever anything in the recipe does (F2).

`PATCH /api/ingredients/:id` takes only `name`, which is required.

##### Validation Rules

Recipe fields:
- `name`: a string of 1–200 characters after trimming. Required on POST, optional on PATCH.
- `description`, `instructions`: a string or null.
- `servings`: a whole number of at least 1. Defaults to 1 on POST; never null.
- `prepTime`, `cookTime`: a whole number of 0 or more (minutes), or null.

Each ingredient line in `ingredients`:
- `ingredientId`: the UUID of an existing ingredient. Lines refer to ingredients by id only.
- `quantity`: a number greater than 0, or null for "to taste". Absent means null.
- `quantityMax`: a number or null. Only allowed when `quantity` is set, and at least `quantity`.
- `unit`: a unit symbol or alias from the D2 list, converted to its symbol; null, absent or blank means a count. An unknown unit is a 400 that lists the allowed units.
- `note`: a string of up to 200 characters, or null.
- `orderIndex` is set by the server and may not be sent.

Ingredient fields:
- `name`: trimmed, lowercased, then 1–100 characters.

Every body and list query rejects unknown fields. Numbers must be JSON numbers: `"2"` is not accepted where `2` is expected.

##### Error Responses

| Status | When | Body |
|--------|------|------|
| 400 | A body or query fails validation | `{ "error": "Validation failed.", "fields": { "<path>": "<message>" } }`, one message per field, with dotted paths such as `ingredients.0.unit` |
| 400 | The body isn't valid JSON | `{ "error": "The request body is not valid JSON." }` |
| 400 | A recipe line names an ingredient id that doesn't exist (Prisma `P2003`) | `{ "error": "One or more ingredient IDs are invalid." }` |
| 404 | The recipe or ingredient in the URL doesn't exist (Prisma `P2025`, or no row found) | `{ "error": "Recipe not found." }` or `{ "error": "Ingredient not found." }` |
| 409 | An ingredient name is already taken, on POST or PATCH (Prisma `P2002`) | `{ "error": "That name already exists." }` |
| 409 | Deleting an ingredient that a recipe uses (Prisma `P2003`) | `{ "error": "Cannot delete ingredient that is used in recipes." }` |
| 413 | The body is over 100 kB | `{ "error": "request entity too large" }` |
| 500 | Anything unexpected | `{ "error": "Internal server error" }`. Details go only to the server log; responses never contain stack traces |
| 503 | `GET /api/health` can't reach the database | `{ "status": "error" }` |

Routes map the Prisma errors they expect themselves. `P2002` is mapped once, in the error handler, so every route that writes a unique field gets the same 409.
 
#### Phase 3: Desktop UI
 
| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Images | POST | `/api/recipes/:id/images` | Upload an image for a recipe |
| Images | GET | `/api/recipes/:id/images` | Get all images for a recipe |
| Images | DELETE | `/api/images/:id` | Delete an image |
| Images | PATCH | `/api/images/:id/primary` | Set image as primary |
| Tags | GET | `/api/tags` | List all tags |
| Tags | POST | `/api/tags` | Create a new tag |
| Tags | PATCH | `/api/tags/:id` | Update a tag |
| Tags | DELETE | `/api/tags/:id` | Delete a tag |
| Sections | GET | `/api/recipes/:id/sections` | Get all sections with instructions |
| Sections | POST | `/api/recipes/:id/sections` | Add a section to a recipe |
| Sections | PATCH | `/api/sections/:id` | Update a section |
| Equipment | GET | `/api/equipment` | List all equipment |
| Equipment | POST | `/api/equipment` | Create equipment |
| Recipe Links | GET | `/api/recipes/:id/links` | Get linked recipes |
| Recipe Links | POST | `/api/recipes/:id/links` | Create link between recipes |
| Sync | GET | `/api/sync?since=:timestamp` | Get changes since timestamp |
 
#### Phase 6: Enhanced Features
 
| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Meal Plans | GET | `/api/mealplans` | List all meal plans |
| Meal Plans | POST | `/api/mealplans` | Create a new meal plan |
| Meal Plans | GET | `/api/mealplans/:id` | Get meal plan with entries |
| Shopping Lists | GET | `/api/shoppinglists` | List all shopping lists |
| Shopping Lists | POST | `/api/mealplans/:id/generatelist` | Generate shopping list from meal plan |
| Nutrition | GET | `/api/recipes/:id/nutrition` | Get nutritional info for a recipe |
| Nutrition | POST | `/api/recipes/:id/nutrition/refresh` | Trigger nutrition data refresh |
 
### 3.3 Sync Strategy
 
For offline-capable clients, the API supports timestamp-based synchronization:
 
**Endpoint:** `GET /api/sync?since=:timestamp`
 
**Response:**
```json
{
  "syncedAt": "2025-05-29T12:00:00Z",
  "recipes": {
    "updated": [...],
    "deleted": []
  },
  "ingredients": {
    "updated": [...],
    "deleted": []
  }
}
```
 
**Implementation Notes:**
- Returns all records where `updatedAt > since`
- Client stores `syncedAt` from response for next sync
- Deleted IDs returned when soft delete is implemented
- Single-user model avoids conflict resolution complexity
 
## 4. External API Integration
 
### 4.1 Spoonacular API Integration (Phase 6)
 
The application will integrate with the Spoonacular API for nutritional information, recipe analysis, and ingredient substitution.
 
#### 4.1.1 Integration Principles
 
1. **API Usage Constraints**
   - Hard limit of 150 points per day
   - Rate limit of 1 request per second
   - Backlink attribution requirement
 
2. **Long-Term Data Persistence**
   - Nutritional data is fundamentally stable
   - Store complete API responses with long expiration (90-180 days)
   - Refresh only when:
     * Recipe ingredients or quantities change
     * User explicitly requests refresh
     * Cache expiration reached (rare)
 
3. **Resilience Architecture**
   - Implement local calculation fallback for basic nutritional values
   - Clear visual indicators of data source (API vs. calculated)
   - Graceful degradation when API limits are reached
 
#### 4.1.2 API Processing Workflow
 
1. **Request Handling**
   - Check local cache for existing data
   - Verify data freshness against configurable thresholds
   - Return cached data unless refresh conditions met
 
2. **Refresh Processing**
   - Queue refresh requests based on priority
   - Implement rate limiting (1 request/second)
   - Store complete API responses
   - Extract and normalize relevant data
 
3. **Fallback Mechanism**
   - Basic nutritional calculation from ingredient data
   - Indicate data source to users
   - Full functionality maintained when API unavailable
 
## 5. Testing Strategy

The project tests with Jest and Supertest. Most tests are integration tests that send real HTTP requests to the Express app and read and write a real PostgreSQL test database. Pure logic, such as the request schemas and the units list, also has unit tests. At the end of Phase 1 there were 220 tests in 10 files, covering 93.6% of statements.

### 5.1 Unit Testing

Unit tests cover code that needs no database:

1. **Testing Scope**
   - The request schemas: what each accepts and rejects, and how it normalises (trimmed names, lowercase ingredient names, defaults)
   - `canonicaliseUnit()` and the unit list: every symbol and alias, and that no spelling means two units
   - Helpers: `isPrismaError()`, the ILIKE escaping, the per-field validation messages
   - The database guard, `assertSafeDatabase()`
   - The CORS policy, mounted on a small Express app with the allowed origins passed in

2. **Testing Approach**
   - Test both what passes and what fails, with `test.each` tables for the rules
   - Pass inputs in directly, for example the guard's environment, rather than changing global state

### 5.2 Integration Testing

Integration tests verify the API end to end:

1. **Testing Scope**
   - Every endpoint's success and error responses
   - Validation through HTTP, including unknown fields and malformed JSON
   - Database behaviour the API relies on: the unique ingredient name (including two simultaneous POSTs, one 201 and one 409), cascade and restrict deletes, line order, and PATCH replacing lines
   - Pagination and ordering on both list endpoints, and search, including literal `%` and `_`
   - The health check, including a simulated database outage (the test swaps the Prisma client's `$queryRaw` for one that fails)

2. **Testing Approach**
   - Supertest calls `app` from `src/app.ts` directly, so no server is started and no port is used
   - Every test starts from the same data: the database is reset to the base seed before each test and emptied after it
   - Where a check could pass by luck, the test sets up the opposite first. For example, the `updatedAt` test backdates the recipe in SQL before the PATCH.

### 5.3 Test and Development Databases

Tests never use the development database (T1):
- Development uses `miseenplace_dev`, and tests use `miseenplace_test`, in the same PostgreSQL container. A script in `docker/initdb/` creates the test database when the container's volume is first initialised.
- Tests read their connection string from `.env.test`. `npm test` loads it with override (`dotenv -o`), and so does Jest's `globalSetup`, so a `DATABASE_URL` already set in the shell can't redirect the tests to another database.
- **The guard.** `assertSafeDatabase()` (`prisma/utils/safe-database.ts`) parses `DATABASE_URL` and throws before anything is deleted unless the database name has an allowed suffix. The test reset allows only `_test`; the seed allows `_test` or `_dev`. Both refuse when `NODE_ENV` is `production`. The error names the database but never includes the URL, which contains the password.

### 5.4 Database Seeding

**Implementation:**
```typescript
// prisma/seeds/base-seed.ts
export async function seed(prisma: PrismaClient): Promise<void> {
  assertSafeDatabase(TEST_OR_DEV);

  // Clear existing data, children first
  await prisma.recipeIngredient.deleteMany({});
  await prisma.recipe.deleteMany({});
  await prisma.ingredient.deleteMany({});

  // Create 12 ingredients, then Beef Chili with 10 ordered lines
}
```

The seed data includes a count with no unit, a range (1–2 tsp), a "to taste" line with no quantity, and preparation notes, so tests and development both see every kind of line. Two seeded ingredients, cumin and kidney beans, aren't used by the recipe.

`base-seed.ts` only exports `seed()`; nothing runs when it's imported, because the test helpers import it. The command-line entry point is a separate file, `prisma/seeds/run.ts`, which loads `.env`, checks the database, seeds and disconnects. `npm run seed` and `npx prisma db seed` both run it with `tsx`.

**Rationale:**
- Ensures the same known data in every test and on every machine
- Enables testing of relationships and edge cases
- Supports CI, which starts from an empty database

### 5.5 Testing Framework Integration

**Implementation:**
```json
{
  "scripts": {
    "test": "dotenv -o -e .env.test -- cross-env NODE_OPTIONS=--experimental-vm-modules jest --runInBand",
    "seed": "tsx prisma/seeds/run.ts"
  }
}
```

```javascript
// jest.config.js (excerpt)
roots: ['<rootDir>/tests'],                              // never the compiled copies in dist/
globalSetup: '<rootDir>/tests/helpers/global-setup.ts',  // once per run
testTimeout: 15_000,
coverageReporters: ['text', 'lcov', 'json-summary'],
```

**Test Setup:**
```typescript
// tests/helpers/global-setup.ts: runs once, before any test file
dotenv.config({ path: '.env.test', override: true });
// ...refuse unless DATABASE_URL names a _test database...
execSync('npx prisma migrate deploy', { env: { ...process.env } });

// tests/helpers/test-lifecycle.ts: called at the top of each describe block
beforeEach(async () => { await resetWithBaseSeed(); });
afterEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });
```

**Rationale:**
- **`--runInBand`** runs test files one at a time. They share one database, so in parallel one file's reset would delete rows in the middle of another file's test.
- **Migrations once per run.** `prisma migrate deploy` in `globalSetup` runs once, instead of once per test file.
- **No `server.close()`.** Tests import `app`, not `server.ts`, so there's no server to close.
- **Type-checking is separate.** ts-jest only transpiles, so type errors don't fail tests; CI runs `npx tsc --noEmit` as its own step.
- **Coverage** is printed after `npm test -- --coverage`, written as HTML to `coverage/lcov-report/`, and shown on each CI run's summary page. There's no threshold yet; one will be set once coverage settles.

### 5.6 End-to-End Testing (Phase 3+)

End-to-End tests will be added when the UI is implemented:

1. **Testing Scope**
   - User workflows (creating and managing recipes)
   - Cross-component interactions
   - UI functionality with API communication

2. **Testing Approach**
   - Use Cypress or Playwright for browser-based testing
   - Implement realistic test scenarios
   - Test across different screen sizes
   - Verify offline functionality
 
## 6. Deployment Architecture
 
### 6.1 Phase 1: Local Development

**Docker Compose Configuration** (the `db` service from `docker-compose.yml`):
```yaml
services:
  db:
    image: postgres:17
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      # 127.0.0.1 only: Docker's published ports bypass host firewalls (S2)
      - '127.0.0.1:5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

**Rationale:**
- **127.0.0.1 only.** Docker's published ports bypass host firewalls such as UFW, so `'5432:5432'` would expose the database to the whole network.
- **A named volume**, not `./postgres-data` in the repository, so a `git clean` can never delete the database.
- **Two databases, one container.** On first start with an empty volume, Postgres creates `POSTGRES_DB` (`miseenplace_dev`) and runs `docker/initdb/`, which creates `miseenplace_test`.

The Compose file also defines an `api` service built from the `Dockerfile`. It isn't used in development, and `docker compose up -d` without a service name would build and start it, so development starts only `db`. Step 8 reworks the `api` service for the Pi.

**Configuration:** `.env` (git-ignored; `.env.example` is the template) sets `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `DATABASE_URL` for development. `.env.test` sets only `DATABASE_URL`, pointing at the test database. Database names must end in `_dev` and `_test`, or the seed and the test reset refuse to run (§5.3).

**Development Workflow:**
1. Start PostgreSQL: `docker compose up -d db`
2. Apply migrations: `npx prisma migrate deploy`
3. Optionally, load the sample data: `npm run seed`
4. Start the server: `npm run dev`
5. Run the tests: `npm test`

After changing `schema.prisma`, create a migration with `npx prisma migrate dev --name <name>`. If it offers to reset the database, say no and find out why first.
 
### 6.2 Phase 2: Pi Deployment (Local)
 
**Infrastructure:**
- Docker on Raspberry Pi
- PostgreSQL container
- Node.js API container
- Persistent volumes for data
 
**Deployment Script:**
```bash
#!/bin/bash
# Deploy to Raspberry Pi
 
# Create backup
docker exec recipe-db pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
 
# Pull latest code
git pull origin main
 
# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
 
# Run migrations
docker exec recipe-api npx prisma migrate deploy
 
# Verify health
curl http://localhost:3000/api/health
```
 
**Backup Strategy:**
- Automated daily backups via cron
- Backup rotation (keep last 7 days)
- Store backups on separate storage
 
### 6.3 Phase 4: Global Access
 
**VPN Configuration:**
- Tailscale or similar mesh VPN
- No port forwarding required
- Automatic key management
- Mobile device support
 
**Security Considerations:**
- VPN-only access (no public exposure)
- Database credentials in environment variables
- Regular dependency updates
 
### 6.4 Continuous Integration

**GitHub Actions Workflow** (`.github/workflows/node.js.yml`):
```yaml
name: CI

on:
  push:
    branches: [ main, 'develop*' ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: recipe_test
        ports:
          - 5432:5432
        # Wait until Postgres accepts connections before the steps start
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      # Ends in _test, so the test guard allows it. There's no .env.test in CI.
      DATABASE_URL: postgresql://test:test@localhost:5432/recipe_test

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Lint
        run: npm run lint

      # The tests don't type-check (ts-jest only transpiles), so do it here
      - name: Type-check
        run: npx tsc --noEmit

      - name: Test with coverage
        run: npm test -- --coverage

      # Put the coverage totals on the run's summary page, even if a test
      # failed. No threshold yet: set one once coverage settles (Step 6).
      - name: Coverage summary
        if: ${{ !cancelled() && hashFiles('coverage/coverage-summary.json') != '' }}
        run: node scripts/coverage-summary.js >> "$GITHUB_STEP_SUMMARY"
```

**CI Strategy:**
- Runs on every pull request into `main`, and on pushes to `main` or `develop*`. A push to any other branch doesn't run CI until it has a pull request.
- Each run starts a throwaway PostgreSQL 17, the same version as development (D4), and waits for its healthcheck. The tests' `globalSetup` applies the migrations, so CI also proves the migrations run on an empty database.
- Node comes from `.nvmrc`, the same version as development; `engines` in `package.json` requires `^22.13.0`.
- The order is cheapest first: lint, then type-check, then tests.
- Deployment stays manual and runs on the Pi itself (Step 8), so CI never needs access to the home network.
 
## 7. Migration Strategy
 
### 7.1 Schema Evolution Approach
 
1. **Migration Planning**
   - Document all schema changes between phases
   - Test migrations with production-like data
   - Create backup before migration
 
2. **Migration Execution**
   - Use Prisma migrations for schema changes
   - Apply migrations: `npx prisma migrate deploy`
   - Validate data integrity post-migration
 
3. **Rollback Strategy**
   - Maintain database backups before migrations
   - Test rollback procedures
   - Document manual recovery if needed
 
### 7.2 Key Migration Examples
 
#### Phase 1 to Phase 3: Instruction Structure Transformation
 
The migration from simple text instructions to structured sections and steps:
 
1. Create RecipeSection and Instruction tables
2. For each recipe with text instructions:
   - Create a default section named "Instructions"
   - Parse text into individual steps (split by newlines or numbered items)
   - Create Instruction records with proper ordering
3. Optionally retain original `instructions` field for reference
4. Validate transformation results
 
#### Adding Soft Delete (Future)
 
When implementing soft delete:
 
1. Add `deletedAt` column to Recipe table
2. Update all queries to filter `WHERE deletedAt IS NULL`
3. Modify DELETE endpoints to set `deletedAt` instead of removing
4. Create cleanup job for permanent deletion after retention period
 
## 8. Conclusion
 
This technical specification outlines the implementation plan for the Recipe App across six development phases. The approach prioritizes:
 
1. **Working Software First** - Phase 1 delivers a complete, testable API
2. **Incremental Deployment** - Pi deployment in Phase 2 establishes the production environment early
3. **User Interface** - Phases 3 and 5 add desktop and mobile interfaces
4. **Global Access** - Phase 4 enables secure remote access
5. **Enhanced Features** - Phase 6 adds advanced functionality
 
The schema evolves to support each phase's requirements while maintaining backward compatibility. Testing ensures reliability at each stage, and the deployment strategy balances automation with simplicity appropriate for a personal project.
 
Each phase builds upon the previous one, with clear migration paths to ensure the application remains functional and efficient as it grows in complexity.