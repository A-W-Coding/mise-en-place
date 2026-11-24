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
   - A client can create a record offline and choose its id, with no risk of colliding with ids made on another device. From Phase 3c, the web client chooses the id of every recipe it creates (D15): an upload retried after a dropped connection then finds the recipe already there, instead of creating it twice.
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

   **Implementation:** `shared/units.ts` lists every unit as a canonical symbol with aliases, for example `g` (gram, grams, gr) and `tbsp` (tablespoon, tablespoons, tbs). The API converts whatever the client sends to the symbol, ignoring case, surrounding spaces and a trailing full stop, and rejects an unknown unit with 400 and the list of allowed units. The database stores only the symbol.

   **Rationale:**
   - "g", "gram" and "grams" must be stored the same way, or quantities can never be added up, for example on a shopping list.
   - The list lives in code rather than a database enum, so adding a unit is a one-line change, not a migration.
   - The module has no server dependencies, so the Phase 3 client uses the same list: Phase 3a moved it to `shared/`, next to the quantity formatting both sides use (§3.4). Each unit records its dimension (mass, volume or other), ready for conversion factors in Phase 6.

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
   - **Soft delete** (`deletedAt`): only if restoring deleted recipes is ever wanted. Offline sync doesn't need it, because the Phase 3c snapshot simply leaves deleted recipes out (D8)
   - **Version tracking** (`previousVersion`): when undo or history is needed
   - **Section links on lines** (`sectionId`): Phase 3b, for groupings like "for the sauce" (§2.3)
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
 
### 2.2 Phase 2: Pi Deployment with Tailscale

Phase 2 deploys the Phase 1 schema to the Raspberry Pi, with PostgreSQL in Docker, reachable only over Tailscale HTTPS (§6.2).

No schema changes in this phase.

### 2.3 Phase 3: User Interface

Phase 3 is split into three parts, each a step of its own (D10, V3). They're built in the order 3a, 3c, 3b: with the phone often off the tailnet, working offline matters more day to day than images and tags (D15).

| Part | What it delivers | Schema changes |
|------|------------------|----------------|
| 3a | The web UI and cooking mode, installable as a PWA, on the Phase 1 schema | None |
| 3b | Structured instructions and sections, images, tags and equipment | The entities below |
| 3c | Offline use: reading from a full snapshot (D8, D9), and recipes created and edited offline, uploaded once the Pi can be reached (D15) | None |

Electron was dropped (D7): the installed PWA is the desktop app. Recipe links moved to Phase 6 (§2.6), where the design document already had them (M1).

#### Phase 3b Entities

Every new table has a UUID primary key, as in Phase 1. Order follows the Phase 1 rule: clients send arrays, and the server sets each `orderIndex` from the position (§2.1, principle 3).

##### RecipeSection Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the section |
| recipeId | UUID | Foreign Key, Required, Cascade | References Recipe |
| name | String | Required, 1–100 characters | Section name, such as "Sauce" or "Base" |
| orderIndex | Integer | Required, set by the server | Position within the recipe |

##### Instruction Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the step |
| sectionId | UUID | Foreign Key, Required, Cascade | References RecipeSection |
| orderIndex | Integer | Required, set by the server | Position within the section |
| text | Text | Required, 1–2,000 characters | What to do |
| timerSeconds | Integer | Optional, 1–86,400 | A timer cooking mode can start for this step |

##### Image Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier, also the files' name |
| recipeId | UUID | Foreign Key, Required, Cascade | References Recipe |
| orderIndex | Integer | Required, set by the server | Upload order, used as the gallery order |
| width | Integer | Required | Width of the stored image, in pixels |
| height | Integer | Required | Height of the stored image, in pixels |
| fileSize | Integer | Required | Size of the stored image, in bytes |
| createdAt | DateTime | Auto: current time | When it was uploaded |

The files live on disk, not in the database (§6.2). There's no `filePath` column: the server builds each path from the id, so no path ever comes from a client.

##### Tag Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the tag |
| name | String | Unique, Required | Normalised like ingredient names: trimmed, lowercase, 1–50 characters |
| color | String | Optional | A `#rrggbb` colour |
| createdAt | DateTime | Auto: current time | When the tag was created |
| updatedAt | DateTime | Auto: update | When the tag was last changed |

##### RecipeTag Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| recipeId | UUID | Foreign Key, Cascade | References Recipe |
| tagId | UUID | Foreign Key, Cascade | References Tag |
| orderIndex | Integer | Required, set by the server | The tag's position on this recipe |

The primary key is `(recipeId, tagId)`, so a tag can't be applied to a recipe twice. The order comes from the `tagIds` array. The recipe list shows a recipe's first two tags as pills beside its name, and the recipe page shows them all, so a dessert can lead with Dessert while still being tagged Vegetarian. Deleting a tag removes it from every recipe: unlike an ingredient, a tag carries nothing a recipe depends on.

##### Equipment Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the item |
| name | String | Unique, Required | Normalised like ingredient names, 1–100 characters |
| createdAt | DateTime | Auto: current time | When the item was created |
| updatedAt | DateTime | Auto: update | When the item was last changed |

##### RecipeEquipment Entity

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the line |
| recipeId | UUID | Foreign Key, Required, Cascade | References Recipe |
| equipmentId | UUID | Foreign Key, Required, Restrict | References Equipment |
| orderIndex | Integer | Required, set by the server | Position in the recipe's list |
| quantity | Integer | Default: 1, at least 1 | How many are needed |
| optional | Boolean | Default: false | Whether the recipe works without it |

##### Changes to Phase 1 Tables

| Table | Change | Why |
|-------|--------|-----|
| Recipe | Add `primaryImageId`: UUID, optional, references Image, `SetNull` | The main image is a property of the recipe. An `isPrimary` flag on images could mark two images as primary, or none (F7) |
| RecipeIngredient | Add `sectionId`: UUID, optional, references RecipeSection, `SetNull` | Groups lines, as in "for the sauce". Null means the line is in no section |
| Recipe | Remove `instructions`, once the migration in §7.2 has moved them into sections | One place for the method, not two |

#### Phase 3b Entity Relationships

| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | RecipeSection | Sections in `orderIndex` order (Cascade) |
| RecipeSection | One-to-Many | Instruction | Steps in `orderIndex` order (Cascade) |
| RecipeSection | One-to-Many | RecipeIngredient | Lines grouped under the section (`SetNull`) |
| Recipe | One-to-Many | Image | The recipe's images (Cascade; the files are deleted too) |
| Recipe | Many-to-One | Image (as primary) | The main image, or none (`SetNull`) |
| Recipe | Many-to-Many | Tag | Through RecipeTag (Cascade on both sides) |
| Recipe | One-to-Many | RecipeEquipment | Equipment lines (Cascade) |
| Equipment | One-to-Many | RecipeEquipment | Lines that use it (Restrict: 409 while a recipe uses it) |

#### Phase 3b Design Notes

1. **A recipe is written as a whole.** Its sections, steps, tags and equipment lines are sent in the recipe's POST or PATCH body and replace what's there, exactly as `ingredients` does in Phase 1 (§3.2). Every change to a recipe goes through one route, in one transaction, and sets the recipe's `updatedAt` (F2). Tags and equipment are shared lists, like ingredients, with endpoints of their own.
2. **Timers belong to steps.** A step's optional `timerSeconds` lets cooking mode offer that step's timer. The original `stepType` field is dropped, because nothing would use it.
3. **Images follow D11** (§3.2): only the re-encoded files are kept, with their metadata stripped.
4. **Indexes:** every foreign key above is indexed, as in Phase 1 (§2.1, principle 7). Tag and equipment names get trigram indexes, so they can be searched like ingredients.

### 2.4 Phase 4: Hardening and Monitoring

Remote access moved into Phase 2, so Phase 4 is about keeping the running system healthy: alerts, dependency updates and the Prisma upgrade (§6.3).

No schema changes in this phase.

### 2.5 Phase 5: Mobile UI

Phase 5 may introduce minor schema additions to support mobile-specific features.

**Potential Additions:**
- User preferences for display settings
- Push notification tokens, so a timer can alert while another app is open: the Pi sends a Web Push at zero (D14)

Offline use needs no schema of its own: it arrives in Phase 3c, as a snapshot of the existing tables (D8).

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
 
##### RecipeLink Entity

Moved here from Phase 3 at the Phase 3 gate (M1): the design document puts recipe variations and links in Phase 6, and nothing in Phase 3 needs them.

| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for the link |
| sourceRecipeId | UUID | Foreign Key, Required, Cascade | The recipe the link is shown on |
| linkedRecipeId | UUID | Foreign Key, Required, Cascade | The recipe it points to |
| linkType | String | Required | "component", "variation" or "pairing" |
| notes | Text | Optional | Notes about the link |

A recipe can't link to itself, and the same link can't be made twice: `(sourceRecipeId, linkedRecipeId, linkType)` is unique.

#### Phase 6 Entity Relationships
 
| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | MealPlanEntry | Meal plan entries using this recipe |
| Recipe | One-to-One | NutritionalInfo | Nutritional information for recipe |
| Recipe | One-to-Many | RecipeLink (as source) | Links from this recipe to others |
| Recipe | One-to-Many | RecipeLink (as linked) | Links from other recipes to this one |
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
   - The schemas are strict: an unknown field is a 400. That allowlist is what stops a client from setting server-owned fields such as `id`, `createdAt` or `orderIndex` (S3). The one exception is the `id` of a new recipe, which the client may choose from 3c (D15). Nothing can change an existing id.

4. **Performance**
   - Every list endpoint is paginated, with a stable order, so the response size is bounded however many recipes there are
   - The one exception is `GET /api/sync` (Phase 3c), which returns everything by design (D8). At personal scale that's a few hundred kilobytes, and an unchanged snapshot costs a 304 with no body (§3.3)
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

   There is no authentication. Access is controlled by the network: the API listens on localhost in development and is reachable only over Tailscale from Phase 2. Browsers may call it cross-origin only from the origins listed in `CORS_ORIGINS`; by default, none. From Phase 3 the web client is served by the same app, from the same origin, so it needs no CORS (F1, §3.4).

7. **Concurrency (F3, Phase 3a)**

   **Implementation:** `GET /api/recipes/:id` returns an `ETag` header made from the recipe's `updatedAt`. A recipe `PATCH` or `DELETE` may send it back in `If-Match`. If the recipe has changed since, the API returns 412 and changes nothing.

   **Rationale:** one person with the editor open on a phone and a laptop could otherwise save one edit over the other without knowing. The header is optional, so curl and scripts keep working; the web client always sends it. The same check covers editing offline (3c, D15): a change saved on the device uploads with the ETag of the version it started from, so a change made elsewhere in the meantime is caught rather than overwritten (§3.4).

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
 
#### Phase 3a: Web UI

3a adds no endpoints. The UI uses the Phase 1 API, with four changes to how the app answers:

- **The UI's files.** The Express app serves the built web client (§3.4). A GET outside `/api` and `/media` that matches no file returns the client's `index.html`, so a deep link such as `/recipes/<id>` loads the app.
- **JSON 404s under `/api`.** An unknown `/api` path returns 404 `{ "error": "Not found." }`, not Express's HTML page.
- **Concurrency headers.** `GET /api/recipes/:id` returns an `ETag`, and recipe `PATCH` and `DELETE` honour `If-Match` (§3.1, principle 7).
- **Lighter lists.** `GET /api/recipes` returns each recipe without its ingredient lines: its id, name, description, servings, times and timestamps, and from 3b its tags and `primaryImageId`. The recipe page fetches the full recipe. Each page of the list stays small, so the client can load page after page as you scroll.

| Status | When | Body |
|--------|------|------|
| 404 | An unknown path under `/api` | `{ "error": "Not found." }` |
| 412 | `If-Match` doesn't match the recipe's current `ETag` | `{ "error": "The recipe has changed since it was loaded." }` |

#### Phase 3b: Structured Recipes, Images, Tags and Equipment

| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Recipes | POST, PATCH | `/api/recipes`, `/api/recipes/:id` | Also accept `sections`, `tagIds`, `equipment` and `primaryImageId` (below) |
| Recipes | GET | `/api/recipes?tag=:tagId` | Recipes with a tag; combines with `search` and paging |
| Tags | GET | `/api/tags` | List tags, paginated, with optional fuzzy search |
| Tags | GET | `/api/tags/:id` | Get a tag |
| Tags | POST | `/api/tags` | Create a tag (name normalised; 409 if it exists) |
| Tags | PATCH | `/api/tags/:id` | Rename or recolour a tag |
| Tags | DELETE | `/api/tags/:id` | Delete a tag, removing it from every recipe |
| Equipment | GET | `/api/equipment` | List equipment, paginated, with optional fuzzy search |
| Equipment | GET | `/api/equipment/:id` | Get an item |
| Equipment | POST | `/api/equipment` | Create an item (name normalised; 409 if it exists) |
| Equipment | PATCH | `/api/equipment/:id` | Rename an item |
| Equipment | DELETE | `/api/equipment/:id` | Delete an item (409 while a recipe uses it) |
| Images | POST | `/api/recipes/:id/images` | Upload one image (`multipart/form-data`, field `image`) |
| Images | DELETE | `/api/images/:id` | Delete an image and its files |
| Image files | GET | `/media/:imageId.webp`, `/media/:imageId-thumb.webp` | The stored image and its thumbnail |

Recipe responses also include `sections`, each with its `steps`; `tags`; `equipment`, each line with its `equipment`; `images`; and `primaryImageId`. Lists are in order, and ingredient lines include `sectionId`.

This closes the gaps in the original Phase 3 API (F6): every part of a recipe can be created, changed and removed, and every shared list (ingredients, tags, equipment) has full CRUD. There are no separate section or step endpoints. A recipe is edited as a whole, so a change can never leave the recipe's `updatedAt` behind (F2).

##### Recipe Body Additions

| Field | Effect when present (absent leaves it untouched) |
|-------|---------------------------------------------------|
| `sections` | Replaces every section and step: an array of `{ name, steps: [{ text, timerSeconds }] }` |
| `ingredients[].sectionIndex` | Puts the line in the section at that position in `sections`; null or absent means no section |
| `tagIds` | Replaces the recipe's tags: unique UUIDs of existing tags, in order. The list shows the first two |
| `equipment` | Replaces the equipment lines: an array of `{ equipmentId, quantity, optional }` |
| `primaryImageId` | Sets the main image to one of this recipe's images, or clears it with null |

Validation:
- `sections[].name`: 1–100 characters after trimming. `steps[].text`: 1–2,000 characters after trimming. `timerSeconds`: a whole number from 1 to 86,400, or null.
- `sectionIndex` must point inside `sections`.
- A body with `sections` must also have `ingredients`, because replacing the sections gives them new ids, and lines would otherwise silently lose their section.
- `equipment[].quantity`: a whole number of at least 1, default 1. `optional`: a boolean, default false.
- `primaryImageId` must be one of this recipe's images (400 otherwise).
- Unknown fields are rejected, as in Phase 1.

##### Image Uploads (D11, S4)

1. **Type:** JPEG, PNG or WebP, recognised from the file's contents rather than its name or `Content-Type`. Anything else, including SVG, GIF and HEIC, is a 415.
2. **Size:** at most 15 MB (413). The upload is held in memory and never written to disk as uploaded.
3. **Pixels:** at most 50 megapixels, read from the image's header before it's decoded, so a small file that would expand into an enormous image is refused (400).
4. **Re-encoding:** sharp turns the image upright using its orientation tag, then writes two WebP files: the image, at most 2,000 px on its longest side, and a 400 px thumbnail. Re-encoding drops all metadata, including the GPS position phones record. The upload itself is discarded.
5. **Names:** the files are `<imageId>.webp` and `<imageId>-thumb.webp`, after the new row's UUID. Nothing from the upload's own name is used.
6. **Limit:** 10 images per recipe (409).
7. **Order of work:** the files are written first, then the row is inserted and the recipe's `updatedAt` set, in one transaction. If the transaction fails, the files are deleted. Deleting an image, or its recipe, deletes its files.

Image files are served with `Cache-Control: public, max-age=31536000, immutable`. A file's contents never change, because a new upload gets a new id.

| Status | When | Body |
|--------|------|------|
| 400 | Over 50 megapixels, not a readable image, or `primaryImageId` isn't this recipe's | `{ "error": "<what was wrong>" }` |
| 409 | The recipe already has 10 images | `{ "error": "A recipe can have at most 10 images." }` |
| 409 | A tag or equipment name already exists (Prisma `P2002`) | `{ "error": "That name already exists." }` |
| 409 | Deleting equipment a recipe uses | `{ "error": "Cannot delete equipment that is used in recipes." }` |
| 413 | The upload is over 15 MB | `{ "error": "Images can be at most 15 MB." }` |
| 415 | Not JPEG, PNG or WebP | `{ "error": "Only JPEG, PNG and WebP images are accepted." }` |

#### Phase 3c: Offline Use

| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Sync | GET | `/api/sync` | Everything a client needs offline, with an `ETag`; 304 when unchanged (§3.3) |
| Recipes | POST | `/api/recipes` | Also accepts an optional `id` (D15) |

A new recipe's body may include `id`, a UUID chosen by the client. If a recipe already has that id, the API answers 409 `{ "error": "A recipe with that id already exists." }` and changes nothing. The web client sends one with every new recipe, online or off, so a retried upload can't create the same recipe twice: a 409 tells it the first attempt arrived. `PATCH` still refuses `id`.

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
| Recipe Links | GET | `/api/recipes/:id/links` | Get linked recipes (moved from Phase 3, M1) |
| Recipe Links | POST | `/api/recipes/:id/links` | Link two recipes |
| Recipe Links | DELETE | `/api/links/:id` | Remove a link |
 

### 3.3 Sync Strategy (Phase 3c, D8)

Offline clients keep a full copy of the data, refreshed from one snapshot endpoint.

**Endpoint:** `GET /api/sync`

**Response:**
```json
{
  "recipes": [...],
  "ingredients": [...],
  "etags": { "<recipe id>": "<ETag>" },
  "tags": [...],
  "equipment": [...]
}
```

Each recipe is as `GET /api/recipes/:id` returns it, and each shared list holds every row. 3c comes before 3b (D15), so until 3b the snapshot holds `recipes`, `ingredients` and `etags`; `tags` and `equipment` join it with 3b.

`etags` gives each recipe the ETag its own `GET` sends, so a device can edit a recipe from its copy with `If-Match` (D15). It sits beside the recipes rather than in them, so each recipe stays as its `GET` returns it, and the ETags stay opaque: the client never works one out from `updatedAt`. Added in Step 17.

**Implementation:**
- The response is deterministic. Every array is sorted (recipes and the shared lists by name, then id; everything inside a recipe by `orderIndex`), and the body holds no timestamp of its own, so the same data always gives the same bytes.
- The `ETag` is a SHA-256 hash of the body. A client sends its last ETag in `If-None-Match`; if nothing has changed, the API answers 304 with no body.
- The response is gzip-compressed.
- Image files aren't in the snapshot. The client's service worker caches them (§3.4).

**Rationale:**
- A snapshot can't miss anything. Timestamp-based delta sync misses rows without an `updatedAt`, edits made through child endpoints, and deletes, unless every write bumps its parent and every delete leaves a tombstone (F2). Replacing the whole copy makes deleted recipes disappear on their own.
- At personal scale the snapshot is small: a few hundred kilobytes for hundreds of recipes, less once compressed, and nothing at all when unchanged.
- The snapshot only ever flows from the server to the client, so it never needs merging. Changes made offline go up separately, through the ordinary recipe endpoints with their `If-Match` check, before the next snapshot comes down (D15, §3.4).
- Delta sync (`?since=`) with a tombstone table stays possible if the collection ever outgrows this, without changing the client's offline model.

### 3.4 Web Client (Phase 3)

The web client is a React single-page app, installable as a PWA, and the only user interface: Electron was dropped (D7).

**Browsers:** the main target is Firefox on Android, installed to the Home Screen. Chromium-based browsers, on the phone or a desktop, are supported too.

**Stack:**

| Concern | Choice | Why |
|---------|--------|-----|
| Build | Vite, TypeScript in strict mode | A fast dev server, and the same language and strictness as the API |
| UI | React | As planned in the design document |
| Routing | React Router | Deep links such as `/recipes/<id>` work, and survive a reload |
| Server data | TanStack Query | Caching, refetching and request state while online |
| Offline copy (3c) | IndexedDB, through idb-keyval | The latest snapshot, and the changes waiting to upload. Neither expires (see Offline below) |
| Styling | CSS Modules, with the theme as CSS custom properties (D13) | Plain CSS, scoped to each component so screens can't restyle each other; light and dark swap the custom properties |
| PWA | vite-plugin-pwa (Workbox) | Generates the manifest and the service worker |
| Unit and component tests | Vitest, Testing Library | Vite-native, with Jest-style syntax |
| End-to-end tests | Playwright | Real browsers (Firefox, the phone's engine, and Chromium), phone-sized viewports, and an offline mode for 3c (§5.6) |

**Layout:** the client lives in `web/`, in this repository, with its own `package.json`. Code both sides use lives in `shared/`: the units list, moved from `src/units.ts`, and the quantity formatting below. One repository means one CI run, one deploy and one copy of the units list.

**One origin (F1):** in production, the Express app serves the built client from the same `https://<name>.<tailnet>.ts.net` address as the API. The client needs no CORS, and the phone gets one install and one offline cache. In development, Vite serves the client on port 5173 and forwards `/api` and `/media` to the API on port 3000, so development is same-origin too.

**Caching:** built files carry a content hash in their names and are cached for a year. `index.html` and the service worker are always revalidated, so a deploy reaches every device on its next visit.

**Quantities (F5):** `shared/quantity.ts` formats and parses amounts, tested once for both sides.
- Spoon and cup measures, and counts, are shown as fractions to the nearest eighth: 0.5 is ½, 1.25 is 1¼, 0.33 is ⅓. Metric units are shown as decimals: 250 g, 1.5 l.
- A range is shown as "2–3". A line with no quantity shows only the ingredient and its note.
- Each line in the editor has one Amount box, with the amount and unit typed together as the recipe writes them: "100 g", "1½ tbsp", "2-3", "1 can". `parseAmount()` splits it into `quantity`, `quantityMax` and a canonical unit (through `canonicaliseUnit()`), and the client sends numbers, so the API stays numeric. With no separate unit picker, a line without a unit spends no space on one.

**Pages (3a):**
- **Recipes:** the list, with the API's fuzzy search. More loads as you scroll, with no button: the next page is fetched before you reach the end. Each row shows the recipe's name and times, and from 3b its first two tags as pills beside the name and a thumbnail. On a desktop the rows become tiles. Each recipe has a ⋮ menu: Edit, Print, Delete.
- **Recipe:** ingredients and method, servings and times, the cooking mode switch, and the same ⋮ menu. From 3b it also shows all of the recipe's tags.
- **Recipe editor:** creates and edits.
  - Every ingredient line is shown, each on one row: Amount, Ingredient, and a ⋮ menu with Move up, Move down, Add note and Remove. A note shows under its line only when it has one.
  - The Ingredients and Method sections collapse, to jump between them.
  - The ingredient picker searches as you type, and can create a missing ingredient on the spot.
  - The API's `fields` errors appear next to their inputs. Saving sends `If-Match`, and a 412 offers to reload the recipe.
  - Delete recipe sits at the bottom.
- **Deleting a recipe:** from its ⋮ menu or the bottom of the editor, always after a confirmation.
- **Options:** theme (system, light or dark) and text size, saved on the device; the timer sound, with a test; and the connection's state, to which 3c adds the offline copy's and any changes waiting to upload. Its Advanced section holds **Ingredients**: list, search, rename and delete, where a delete refused with 409 says the ingredient is in use. Ingredients are shared data, so they're kept out of the everyday screens.
- **Cooking mode:** a switch on the recipe page that keeps the screen on, and at heart that's all it is. The page itself doesn't change: the whole recipe stays readable and scrollable, so cooking takes no more taps than reading. The Screen Wake Lock API keeps the screen on (Firefox 126 and later, and Chromium) until the switch is turned off or you leave the recipe, and the lock is taken again whenever the page becomes visible. Where the API is missing, the switch says the screen may sleep, rather than failing silently. A one-step-at-a-time view is optional, and waits for Phase 5.
- **Timers:** for mid-length waits such as "stir every 15 minutes", not for short steps, or for the oven, which has its own. Most recipes won't need one, so they stay small and out of the way:
  - A small button adds a timer, with a length and an optional label. Several can run at once.
  - Running timers are small chips at the edge of the screen, and never cover the recipe.
  - A timer that finishes plays a sound, vibrates where supported, and grows until it's dismissed.
  - Each counts from its end time rather than counting ticks, so it stays right if the screen locks.
  - Timers ring while the app is on screen, which cooking mode keeps it (D14). On Android the browser pauses a page soon after you switch away, so a timer can't ring while another app is open. A short note by the timers says so, and alerts in the background wait for Phase 5's push notifications.
  - In 3b, a step with a `timerSeconds` gets a small button beside it that starts that timer.
- **Printing:** a print stylesheet reduces a recipe to its ingredients and method, without navigation, buttons or a footer.

3b adds the section, step, tag, equipment and image editors, tag filtering on the list, and tag pills. A pill uses its tag's colour as the background, with dark or light text chosen for contrast. Since 3c comes first (D15), 3b also keeps the offline copy and waiting changes whole: the snapshot gains tags and equipment, waiting changes carry sections and steps, and images join the offline copy.

**Keeping devices in step:** the app may be open on the laptop and the phone at the same time. From 3a:
- A device refreshes its data when the app opens, when it comes back to the foreground (switching back to the app or its tab), when its connection returns, and right after it saves a change of its own. Nothing refreshes in the background, and nothing polls on a timer.
- A **Refresh** button refreshes at any time.
- So with the app open on both, a recipe added on the laptop appears on the phone the next time the phone's app comes to the front, or when Refresh is tapped. The same holds the other way round.
- If the recipe on screen was changed elsewhere, the page shows the new version at the next refresh. If it was deleted, the page says so instead of failing. An edit started before the change gets a 412 when saved, with an offer to reload (§3.1, principle 7).
- In 3a these refreshes are TanStack Query's refetch on focus and reconnect. From 3c, the same moments also upload any changes waiting on the device, then fetch the snapshot.

**Offline (3c, D8, D9):** the copy on the device must survive weeks without the app being opened.
- **The app's files:** from 3a, the service worker caches them, so the app opens with no connection, however long it's been since it was last used.
- **The data:** the offline copy is the latest snapshot, kept in IndexedDB as one record with its ETag and the time it was fetched. It has no expiry. It's replaced only when a newer snapshot has fully arrived, so a failed or partial refresh never leaves the device with less than it had. TanStack Query's own persistence isn't used for this, because by default it silently discards anything older than 24 hours.
- **Refreshing:** the client fetches `/api/sync` at the moments listed under "Keeping devices in step". Every page shows the stored snapshot at once while it asks the API, and the API's answer replaces it when it comes, so a page never waits on a network that isn't there (reaching the Pi with Proton on can take seconds to fail; found in Step 19). When the Pi can't be reached, the page keeps the snapshot, with a banner saying so and when the copy was last refreshed. Search then matches recipe names on the device, more simply than the API's fuzzy search. The editor waits for the API's version, or for the API to fail, so an older copy isn't edited.
- **Retrying:** if a refresh fails, the client tries again while the app is on screen: after 15 seconds, then at doubling intervals up to every 5 minutes, until one succeeds. The browser's "online" signal only means the phone has a network, not that the Pi is reachable (Tailscale may be off, for example), so the client retries rather than waiting for that signal alone. Refresh tries straight away. Waiting changes upload on the same schedule.
- **Keeping the browser from clearing it:** the client asks for persistent storage with `navigator.storage.persist()`, so the browser won't clear the copy when the device runs low on space.
  - Firefox asks you to allow it, and only in response to a tap, so the request comes from a **Protect** button on the "Offline copy" line rather than happening silently.
  - Chrome decides by itself, without asking, and grants it to installed apps.
  - Neither Firefox nor Chrome puts a time limit on a site's data, and Safari's seven-day limit doesn't apply to Home Screen apps.
  - Firefox's "Delete browsing data on quit" setting would erase the copy, so it must stay off.
- **Visible state:** an "Offline copy" line shows how many recipes are stored, when they were last refreshed, whether storage is protected, and how many changes are waiting to upload, with the Refresh button and, until storage is protected, the Protect button. Protecting matters more once changes are waiting, since they're the only copy until they upload.
- **What can still remove it:** clearing the browser's data for the site, or removing the app from the Home Screen.
- **Images (3b):** images arrive after 3c, and 3b adds them to the offline copy: thumbnails are cached ahead of time, and full images as they're viewed, up to a limit. Adding an image needs a connection.

**Editing offline (3c, D15):** recipes can be created and edited with the Pi out of reach. The phone is often off the tailnet, because Android runs one VPN at a time.
- **Saving:** Save always tries the Pi first. If the Pi can't be reached (no answer, or a 502 or 504 from Tailscale), the change is kept on the device as a *waiting change*, and the editor closes as it does after any save. So the same Save works online and off, and a connection that drops mid-save loses nothing.
- **What works offline:** creating and editing recipes. Deleting a recipe, and renaming or deleting an ingredient, still need the Pi; offline, they say so rather than waiting. They're rare, and they're the changes most likely to collide with another device.
- **What you see:** a waiting change shows straight away, marked "Waiting to upload": a new recipe in the list, and an edited recipe's new version on its page, with when it was saved. Opening the editor on a recipe with a waiting change edits that version. So there's at most one waiting change per recipe, and it keeps the ETag of the version it started from.
- **New ingredients:** offline, the ingredient picker suggests names from the offline copy. A name that isn't there becomes a new ingredient, created when the change uploads. If it was created elsewhere meanwhile (409), the existing one is used.
- **Checking before saving:** the editor checks everything the API would refuse, such as a missing name, a length or an amount, so a change saved offline is rarely refused when it uploads.
- **Uploading:** at the moments under "Keeping devices in step", and on the retry schedule above, waiting changes upload by themselves, oldest first, before the snapshot is fetched. New ingredients go first, then a `POST` for a new recipe, with its id, or a `PATCH` with `If-Match` for an edit. Each success replaces the recipe in the offline copy with the API's reply, so a page never steps back to the old version while the next snapshot loads. If the Pi can't be reached, the round stops and tries again later.
- **A retried create:** a 409 for a new recipe's id means an earlier attempt arrived but its answer was lost, so the change counts as uploaded.
- **When an upload can't go through,** the change stays on the device, marked "Needs your attention", with a banner until it's settled:
  - **Changed elsewhere (412):** both versions are shown, with Keep mine (saved over the other), Keep theirs (mine discarded) and Keep both (mine saved as a new recipe, with "(copy)" after its name).
  - **Deleted elsewhere (404):** save it as a new recipe, or discard it.
  - **Refused (400):** the editor opens on the change, with the API's messages beside their fields.
  - Nothing is discarded without a tap, and discarding asks first.

**Accessibility:** semantic HTML, labelled form controls, visible focus, and text that scales with the browser's font size. Cooking mode must work one-handed.

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

### 5.6 Web Client and End-to-End Testing (Phase 3)

Phase 3 adds tests at three levels:

1. **API tests**, in the style of §5.2, for everything the API gains:
   - 3a: JSON 404s under `/api`; `If-Match`, where a stale ETag gets 412 and changes nothing; and list responses without ingredient lines
   - 3b: sections, steps, tags and equipment through the recipe body, including the `sectionIndex` rules; tag and equipment CRUD, including the 409s; and the image rules (D11). A JPEG carrying GPS data must come back without it. SVG, GIF and HEIC must be refused, and so must a file over 15 MB, an image over 50 megapixels and an 11th image
   - 3c: the snapshot, its ETag and the 304, and that a deleted recipe is missing from the next snapshot; a new recipe with an id chosen by the client, a 409 that changes nothing when the id is taken, and `id` still refused by `PATCH`
2. **Unit and component tests:**
   - `shared/quantity.ts`: formatting and parsing, as `test.each` tables, in the Jest suite beside the units tests, since it needs no browser
   - Client components with logic, in Vitest with Testing Library: the ingredient-line editor, mapping the API's `fields` errors onto inputs, and the timers, with fake timers
   - The offline store (3c): with the network down, a snapshot fetched 60 days earlier is still served; a failed or partial refresh leaves it untouched; only a complete new snapshot replaces it
   - Waiting changes (3c): kept when the Pi can't be reached, one per recipe, and across a reload; uploaded oldest first, with new ingredients before their recipe; a 409 on a create counted as uploaded; a 412, 404 or 400 marked as needing attention, with nothing discarded without a tap
3. **End-to-end tests** (Playwright):
   - Against the built client served by the real API, with a `_test` database reset to the base seed before each test (§5.3)
   - Every flow in Firefox and Chromium, at a phone size and a desktop size. Firefox because it's the phone's browser, and phone sizes because the phone is the main device
   - 3a: find a recipe by search; scroll the list until the next page loads; create one with lines and a new ingredient; edit it; get the 412 prompt when it changed elsewhere; delete it; turn cooking mode on and off; run two timers at once, and dismiss one when it finishes. With two browser contexts standing in for the laptop and the phone, a recipe added in one appears in the other when it returns to the foreground or presses Refresh
   - 3b: upload an image and make it the main one; edit sections, steps, tags and equipment; start a step's timer from its button
   - 3c: load the app, go offline (`context.setOffline(true)`), and check that recipes still open. Then reload the page while still offline, which is a fresh start from the stored copy rather than the open tab, and check again. Come back online, and see a change made elsewhere arrive. Make a refresh fail by blocking `/api/sync`, unblock it, and check the retry gets the new snapshot without a restart
   - 3c, editing offline: create a recipe and edit another while offline, reload, and check both are still there, marked as waiting. Come back online and check both reach a second context without a tap. Edit a recipe offline while a second context changes it, and choose each of Keep mine, Keep theirs and Keep both. Let a create reach the API but lose its answer, and check the retry doesn't make a second copy

CI runs the client's lint, type-check and unit tests, then the Playwright tests in Firefox and Chromium against the PostgreSQL service, alongside the API's tests. Playwright's Firefox is the desktop build of the same engine as Firefox for Android, so a few things, such as the install prompt and wake lock, are also checked by hand on the phone at the end of 3a and 3c.

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

This file is for development only. The Pi runs the production file, `docker-compose.prod.yml` (§6.2).

**Configuration:** `.env` (git-ignored; `.env.example` is the template) sets `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `DATABASE_URL` for development. `.env.test` sets only `DATABASE_URL`, pointing at the test database. Database names must end in `_dev` and `_test`, or the seed and the test reset refuse to run (§5.3).

**Development Workflow:**
1. Start PostgreSQL: `docker compose up -d db`
2. Apply migrations: `npx prisma migrate deploy`
3. Optionally, load the sample data: `npm run seed`
4. Start the server: `npm run dev`
5. Run the tests: `npm test`

After changing `schema.prisma`, create a migration with `npx prisma migrate dev --name <name>`. If it offers to reset the database, say no and find out why first.
 
### 6.2 Phase 2: Pi Deployment with Tailscale

The API runs on a Raspberry Pi in Docker and is reachable only from the user's own devices, over Tailscale with HTTPS. `docs/deployment.md` is the runbook, from installing the operating system to the restore test.

**Infrastructure** (`docker-compose.prod.yml`, Compose project `miseenplace-prod`):
- `db`: `postgres:17`, the same version as development (D4), with a named volume and a `pg_isready` healthcheck. It has **no published port**: the API reaches it over the Compose network (S2).
- `api`: built on the Pi from the `Dockerfile`, so it's natively arm64. It runs as the non-root `node` user, is published on `127.0.0.1:3000` only, and has a healthcheck on `/api/health`.
- Both use `restart: unless-stopped`, so they come back after a reboot, and Docker's `local` log driver, which keeps about 100 MB of logs per container.
- `tailscale serve --bg 3000` publishes `https://<name>.<tailnet>.ts.net` to the tailnet only and forwards it to `127.0.0.1:3000`. Tailscale issues the certificate. Funnel, which would publish to the internet, stays off.
- `.env` on the Pi, never in git, sets `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `COMPOSE_FILE=docker-compose.prod.yml`. The database name has no `_dev` or `_test` suffix and the image sets `NODE_ENV=production`, so the seed and the test reset both refuse to touch it (§5.3).

**Deploying** (`scripts/deploy.sh`, run by hand on the Pi):
1. Start the database and wait until it's healthy
2. Back up with `scripts/backup.sh`, and stop if that fails (T3)
3. `git pull --ff-only origin main`
4. Build the new API image while the old one keeps serving
5. Run `prisma migrate deploy` from the new image. The Prisma CLI is a production dependency, pinned by D3
6. Start the new version, then retry `/api/health` for up to a minute. If it never passes, print the API logs and fail

Nothing pulls from GitHub on its own, so every migration runs while someone is watching.

**Backups (V4):**
- `scripts/backup.sh` runs daily from cron. It writes a `pg_dump -Fc` dump to `/srv/miseenplace/backups`, outside the repository, and keeps it only if `pg_restore` can read all of it. Only then does it remove dumps older than 7 days, so a failing backup never deletes the good ones.
- `scripts/restore-check.sh` restores the newest dump into a scratch database and compares its row counts with the live database.
- `scripts/offsite.sh` runs straight after it and keeps an encrypted copy of the backups folder in Backblaze B2, with restic over B2's S3-compatible API. It keeps 7 daily, 4 weekly and 6 monthly snapshots, and on Sundays checks a random tenth of the stored data. restic encrypts on the Pi. Its settings file, with the password, is also kept off the Pi, or the copy couldn't be decrypted.
- Still to come: backups of the images directory once Phase 3 adds images.

**Storage:** the Pi should boot from an SSD, because PostgreSQL on an SD card is the likeliest way to lose data. "Moving to an SSD" in `docs/deployment.md` covers moving an install that started on an SD card.

**From Phase 3:**
- **3a:** the Dockerfile gains a stage that builds `web/`, and the API image serves the result (§3.4). `deploy.sh` doesn't change: one image, one deploy.
- **3b:** image files live in a second named volume, mounted into the `api` container and owned by its `node` user. The backups cover them: `backup.sh` saves the image files beside each dump, and `offsite.sh` sends both to B2, which closes the last item of Step 8.7. sharp ships prebuilt for 64-bit ARM Linux, so nothing extra is installed on the Pi.
- **3c:** nothing changes on the Pi.

### 6.3 Phase 4: Hardening and Monitoring

Remote access arrived with the Pi in Phase 2 (§6.2): Tailscale only, with no port forwarding and nothing exposed to the internet. Phase 4 makes the running system easier to keep healthy:
- Uptime and disk-space alerts
- Dependency updates as pull requests that CI tests (Dependabot or Renovate), including GitHub Actions versions
- The Prisma upgrade, as its own task after reading that version's upgrade guide (V5)
- Optionally, an API check that requests come from the expected Tailscale user (S1)

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

#### Phase 1 to Phase 3b: Instruction Structure Transformation

The move from free-text instructions to sections and steps takes two migrations:

1. The first creates the Phase 3b tables and columns (§2.3) and leaves `Recipe.instructions` in place.
2. In the same migration's SQL, a data step gives every recipe that has instructions one section named "Method", and turns each non-empty line of the text into a step, in order. Recipes without instructions get no section.
3. After the deploy, check a few recipes in the UI. The backup `deploy.sh` took before migrating is the way back.
4. A later migration drops `Recipe.instructions`, once nothing reads it.

Two migrations keep the original text until the new structure has been seen to be right.

#### Adding Soft Delete (Future)

Offline sync doesn't need soft delete: the Phase 3c snapshot leaves deleted recipes out, so they disappear from devices at the next refresh (D8). Soft delete would only come with a "recently deleted" feature:

1. Add a `deletedAt` column to Recipe
2. Filter `WHERE "deletedAt" IS NULL` in every query, including the snapshot
3. Make DELETE set `deletedAt` instead of removing the row
4. Purge rows deleted longer ago than a set period

## 8. Conclusion
 
This technical specification outlines the implementation plan for the Recipe App across six development phases. The approach prioritizes:
 
1. **Working Software First** - Phase 1 delivers a complete, testable API
2. **Incremental Deployment** - Pi deployment in Phase 2 establishes the production environment early, with Tailscale HTTPS from day one
3. **User Interface** - Phase 3 adds the web UI in three parts (the UI and cooking mode, then offline use, then structured recipes and images), installable as a PWA on phone and desktop. Phase 5 polishes it for mobile
4. **Hardening** - Phase 4 adds alerts, monitoring and dependency updates
5. **Enhanced Features** - Phase 6 adds advanced functionality
 
The schema evolves to support each phase's requirements while maintaining backward compatibility. Testing ensures reliability at each stage, and the deployment strategy balances automation with simplicity appropriate for a personal project.
 
Each phase builds upon the previous one, with clear migration paths to ensure the application remains functional and efficient as it grows in complexity.
