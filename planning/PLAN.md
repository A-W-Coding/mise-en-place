> Created on 27 September 2026. This is the live copy: progress is ticked off here as each step is done.

# Mise en place: hardening plan (Phase 1 to Phase 2)

> **Status**
> - Current step: **Step 5: Update the API to match**
> - Last updated: 2026-11-02 (Step 4 done: Phase 1 migration applied, no drift, seed runs)
> - Blockers: none

## How to use this file
- Work through the steps in order. Each step gives a goal, why it matters, tasks as checkboxes, and a "done when" test.
- IDs point to the reasoning behind a task. `S1`–`M6` are in `design-review.md`; `A1`–`A10` are in `code-audit.md`.
- Decisions live in the Decisions table. A step that needs a Pending decision waits until it's made.
- Record progress in the Progress log at the bottom, and keep the status block current.

## Background

### What already exists
According to the code audit, Phase 1 is largely built:
- **Schema:** matches the technical spec field for field. That means UUID keys, `servings @default(1)` and `quantity @default(0)`, with Cascade on Recipe→RecipeIngredient and Restrict on Ingredient→RecipeIngredient.
- **Endpoints:** all ten recipe and ingredient CRUD endpoints exist. Recipes come back with their ingredients nested.
- **Error codes:**
  - P2025 → 404
  - P2003 → 400 when a recipe body has a bad ingredient reference
  - P2003 → 409 when deleting an ingredient that's still in use
- **Ingredient names:** lowercased and trimmed on write. A duplicate POST returns 409, but only through a pre-check query, not a database constraint.
- **Search:** one `?search=` parameter, using pg_trgm and ILIKE together, with results ranked by similarity.
- **Tests:** Supertest integration tests cover happy paths, 400/404/409, cascades and fuzzy ranking.
- **Structure:** `app` is exported separately from the server.

### Where this plan comes from
Two reviews looked at different things:
- The **code audit** (`code-audit.md`) checked whether the code matches the spec.
- The **design review** (`design-review.md`) checked whether the spec itself is right.

The rule that reconciles them: **settle the spec first, then bring the code in line with the new spec.** Something the audit marked "matches spec" can still need changing if the spec changes.

### Where the reviews disagree, and how it's resolved
| Topic | Code audit said | Design review said | Resolution |
|---|---|---|---|
| `quantity` and `unit` | `quantity @default(0)` and a required `unit` are correct. Validate that `unit` is present | Make both nullable, because "to taste" isn't 0 and "3 eggs" has no unit. Take units from a canonical list | Change the schema (Step 4). Validation then checks that `unit` is empty or on the list (Step 5) |
| How to validate | Extend the small helpers, e.g. add `validateOptionalInt` | Use a schema library such as Zod | Decision D1 (Step 1). Use one approach everywhere |
| `updatedAt` and sync | Test that PATCH changes `updatedAt`, because Phase 3 sync relies on it | Timestamp-based delta sync misses edits to child records and all deletes | Keep the test, which is useful whatever the sync design. Choose that design at the Phase 3 gate (D8) |
| Everything else | Both reviews agree: unique ingredient names, a real health endpoint, pg_trgm with a GIN index, pagination, a regenerated ERD | | Covered in Steps 3–7 |

## Decisions
| ID | Decision | Recommendation | When | Status / answer |
|---|---|---|---|---|
| D1 | How to validate requests | **Zod.** One schema per route gives validation, TypeScript types and an allowlist of fields in one place. Extending the helpers is acceptable if it's used everywhere | Step 1 | **Decided 2026-10-27: Zod** |
| D2 | How units are enforced | **A canonical unit list with aliases, in API code.** "gram" and "grams" both become `g`. A database enum would need a migration for every new unit | Step 1 | **Decided 2026-10-27: a canonical list with aliases, in API code.** Starting list as in Step 1 |
| D3 | Prisma version | **Pin the exact version already in use.** Upgrading is a separate task later (V5). On 27 Sept 2026, npm's `latest` tag for `prisma` pointed at `8.0.0-rc.17`, so an unpinned fresh install could pull a pre-release major | Step 1 | **Decided 2026-10-27: pin `prisma` and `@prisma/client` to exactly 6.6.0** |
| D4 | Postgres version | **17**, in dev, CI and on the Pi, adopted now while dev data is disposable. 18 also works but moves the Docker data path (see the Step 3 note) | Step 1 | **Decided 2026-10-27: 17.** The dev data is disposable (one placeholder recipe) |
| D5 | Move Tailscale into Phase 2 | **Yes.** The PWA needs HTTPS and a single origin (F1) | Before Step 7 | **Decided 2026-10-27: yes** |
| D6 | List response shape for pagination | **Keep a plain array and add an `X-Total-Count` header**, which breaks nothing. The alternative is a `{ items, total, limit, offset }` envelope | Step 5 | **Decided 2026-11-02: a plain array plus an `X-Total-Count` header** |
| D7 | Electron | **Drop it or defer it.** An installed PWA already covers the desktop (V2) | Phase 3 gate | Deferred |
| D8 | Sync design | **A full snapshot with an ETag first.** Add delta sync with tombstones only if it's ever needed (F2) | Phase 3 gate | Deferred |
| D9 | Offline editing | **Read-only offline** to begin with (F3) | Phase 3 gate | Deferred |
| D10 | Split Phase 3 | **Yes, into three:** 3a is the UI plus cooking mode on the Phase 1 schema; 3b is structured instructions, images and tags; 3c is offline support (V3) | Phase 3 gate | Deferred |
| D11 | Image upload rules | Allowed types, size and pixel caps, re-encoding (S4) | Phase 3 gate | Deferred |
| D12 | Nutrition data source | **USDA FoodData Central** as the primary source. Use Spoonacular only for live, uncached extras (V1) | Phase 6 | Deferred |

## Revised phase map
| Phase | Original | Proposed |
|---|---|---|
| 1 | Backend API | Backend API **plus hardening** (Steps 1–7 below) |
| 2 | Pi on the home network | The Pi **plus Tailscale HTTPS** from day one (Step 8) |
| 3 | Desktop UI (a very large phase) | The UI, gated by D7–D11 and probably split into 3a, 3b and 3c |
| 4 | Global access via Tailscale | Hardening and monitoring, since Tailscale is already done |
| 5 | Mobile polish | Unchanged |
| 6 | Enhanced features | Unchanged, except nutrition comes from USDA FoodData Central (D12) |

---

## Step 1: Make the decisions (no code)
**Goal:** settle D1–D4, and D5 if you're ready.

**Why:** Steps 3–5 depend on these answers.

- [x] D1: choose the validation approach
- [x] D2: choose how units are enforced, and agree the starting unit list below
- [x] D3: read the exact `prisma` and `@prisma/client` versions from package.json, then either pin them exactly (no `^`) or confirm the range can't cross a major version
- [x] D4: choose the Postgres version
- [x] Record each answer and its date in the Decisions table

**Starting unit list for D2** (canonical symbol first, example aliases in brackets):
- Mass: `g` (gram, grams, gr), `kg`, `oz` (ounce, ounces), `lb` (pound, pounds, lbs)
- Volume: `ml` (millilitre, milliliter, mls), `l` (litre, liter), `tsp` (teaspoon, teaspoons, tsp.), `tbsp` (tablespoon, tablespoons, tbs, tbsp.), `cup` (cups), `fl oz`
- Other: `pinch`, `clove`, `slice`, `can` (tin), `bunch`, `handful`
- No unit (null) means a count, as in "3 eggs".

Matching ignores case, surrounding spaces and a trailing full stop. Units can be added at any time, because the list is code rather than a migration.

**Done when:** D1–D4 are recorded in the table.

## Step 2: Inspect the files neither review saw (read-only)
**Goal:** find out what's true today in the files the audit couldn't see (A8).

**Why:** later steps should fix real problems, not assumed ones, and several fixes depend on these answers. For example, if `pg_trgm` was enabled by hand rather than in a migration, search will fail in CI and on the Pi.

Check each item and record ✅ or ❌, with a note, in the Progress log:
- [x] Some migration in `prisma/migrations/` contains `CREATE EXTENSION ... pg_trgm` (A3)
- [x] The test reset (`tests/helpers/test-lifecycle.ts`) and the seed refuse to run against a non-test database (T1)
- [x] Tests use their own database, separate from dev (T1)
- [x] How Jest runs: in parallel, or with `--runInBand` or `maxWorkers: 1`. Also where `prisma migrate deploy` runs: in each file's `beforeAll`, or once per run (T1)
- [x] Test files are named `*.test.ts`; confirm with `npx jest --listTests` (A5)
- [x] No handler passes `req.body`, or `...req.body`, into a Prisma call (S3)
- [x] How recipe bodies refer to ingredients (by `ingredientId`, by name, or both), and how `toRecipeIngredientCreateData` builds the write
- [x] What the error handler does with unknown errors (a 500? does it leak stack traces?) and with Prisma errors (A2)
- [x] In `docker-compose.yml`: how the Postgres port is bound, where the data lives (`./postgres-data` inside the repo?) and the image version (S2, M4)
- [x] In the CI workflow: whether it sets `DATABASE_URL`, waits for Postgres to be healthy and runs lint and coverage, plus its Node version and action versions (T2)
- [x] `.gitignore` covers `.env*` and any data directory (M4)
- [x] In package.json: the scripts, the Prisma version, any Node `engines` field, and whether `zod` and `cors` are installed. Also whether ESLint and Prettier configs exist
- [x] How CORS is set up in `app.ts`; a bare `cors()` call allows every origin (S1)
- [x] Whether a README and API docs exist
- [x] Update the **Commands** and **Code map** sections of the local working notes (not committed) with what you found

**Done when:** every item has a ✅ or ❌ in the Progress log, each ❌ names the step that fixes it, and the commands in the local working notes are the real ones.

## Step 3: Make the tests safe and reliable
**Goal:** tests that can't touch real data and give the same result every run.

**Why:** Steps 4–6 change the schema and every handler, so you need a trustworthy safety net first. The current reset wipes every table, so one wrong `DATABASE_URL` erases your recipe collection (T1). Jest also runs test files in parallel, so one file's reset can delete rows in the middle of another file's test (T1).

- [x] **Separate databases.** Dev uses `<name>_dev` and tests use `<name>_test` (for example `miseenplace_dev` and `miseenplace_test`). Both live in the same Postgres container. Tests load their connection string from `.env.test`. Create the test database with a Postgres init script or a one-off `createdb`.
- [x] **Guard.** Add a small `assertSafeDatabase()` helper that parses `DATABASE_URL` with `new URL()` and checks the database name. The test reset allows only names ending in `_test`. The seed allows `_test` or `_dev`. Both refuse when `NODE_ENV=production`, and they throw a clear error before touching anything.
- [x] **Jest.**
  - Run test files one at a time: add `--runInBand` to the test script, or set `maxWorkers: 1`.
  - Move `prisma migrate deploy` into a `globalSetup` file, so it runs once per test run instead of once per test file.
  - Load `.env.test` inside `globalSetup` as well, because that file runs in its own context.
  - If tests only use `app`, remove `server.close()` from teardown.
- [x] **Test discovery (A5).** Added 2026-10-27 from Step 2.
  - Stop Jest picking up the compiled copies in `dist/`, for example with `roots: ['<rootDir>/tests']` in `jest.config.js`. Otherwise every suite runs twice.
  - Either load `tests/helpers/jest-setup.ts` through `setupFilesAfterEnv` (it sets a 15-second timeout), or delete it. Today nothing loads it.
  - Confirm that `npx jest --listTests` lists only the files in `tests/`.
- [x] **pg_trgm.** Not needed: Step 2 found the migration. If Step 2 found no migration for it:
  - Run `npx prisma migrate dev --create-only --name enable_pg_trgm`.
  - Put `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the generated file. `IF NOT EXISTS` keeps it safe where you already enabled it by hand.
  - Make sure it sorts before any migration that uses trigram functions.
- [x] **Lint (T2).** Added 2026-10-27 from Step 2. The CI target below runs lint, but there's no config for it yet.
  - Add ESLint with a flat config (`eslint.config.js`) using `typescript-eslint`'s recommended rules, and an `npm run lint` script.
  - Fix what it reports, or disable a rule explicitly with a comment saying why, so lint passes before CI depends on it.
- [x] **CI.** Fix whatever Step 2 found. The target is:
  - `env: DATABASE_URL: postgresql://test:test@localhost:5432/recipe_test`, matching the Postgres service's user, password and database name
  - A Postgres service with `options: --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10`, so tests wait for the database
  - `actions/checkout@v4`, and `actions/setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm`
  - Steps in this order: `npm ci`, then `npx prisma generate` (unless a postinstall script already does it), then lint, then the tests with `--coverage`
  - The Postgres image version chosen in D4
- [x] **Node version.** Add a `.nvmrc` file and an `"engines"` entry in package.json, both set to the Node LTS major you develop on.
- [x] **Dev Compose file.**
  - Bind Postgres to `127.0.0.1:5432:5432`, never to every interface. Docker's published ports bypass UFW (S2).
  - Use a named volume (`pgdata:/var/lib/postgresql/data`) instead of `./postgres-data` inside the repo (M4).
  - Use the D4 image version, add a `pg_isready` healthcheck, and remove the obsolete `version:` key.
  - **If you choose Postgres 18 or later:** the official image moved its data directory. Mount the volume at `/var/lib/postgresql` instead, or the data won't persist.
  - Dev data is assumed to be disposable, but ask me before deleting the old `./postgres-data` directory.
- [x] **Guard tests.** Add unit tests showing that the test reset's guard throws for `.../miseenplace` and `.../miseenplace_dev`, and passes for `.../miseenplace_test`.

**Done when:**
- `npm test` passes twice in a row locally.
- CI is green twice in a row. Running twice exposes tests that only pass in one order.
- Pointing the reset at a non-test database URL throws before anything is deleted.

## Step 4: One schema migration for Phase 1
**Goal:** fix the data model before any real data exists, in one migration.

**Why:**
- Unique names stop duplicate ingredients (A1, F4).
- An order field and a preparation note are basic recipe needs (F4).
- A nullable quantity and unit record "to taste" and "3 eggs" honestly (F5).
- Timestamps on Ingredient are needed by any sync design (F2).
- Indexes keep lookups and search fast on the Pi (M2).

Target models (Phase 1 only). Leave the generator and datasource blocks as they are (D3):

```prisma
model Recipe {
  id                String             @id @default(uuid())
  name              String
  description       String?
  servings          Int                @default(1)
  prepTime          Int?               // minutes
  cookTime          Int?               // minutes
  instructions      String?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  recipeIngredients RecipeIngredient[]

  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin)
}

model Ingredient {
  id                String             @id @default(uuid())
  name              String             @unique // stored trimmed and lowercase
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  recipeIngredients RecipeIngredient[]

  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin)
}

model RecipeIngredient {
  id           String  @id @default(uuid())
  recipeId     String
  ingredientId String
  orderIndex   Int     // set by the server from the line's position in the array
  quantity     Float?  // null means "to taste" or unspecified
  quantityMax  Float?  // upper bound of a range, as in "2–3"
  unit         String? // canonical symbol from the units module; null means a count
  note         String? // preparation, e.g. "finely diced"

  recipe     Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  ingredient Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Restrict)

  @@index([recipeId])
  @@index([ingredientId])
}
```

Notes:
- **Reset the dev data first.** Any duplicate ingredient names already stored would make `@unique` fail. The new required columns (`orderIndex`, and `updatedAt` on Ingredient) have no default. That's fine on a disposable dev database; a database with real data would need defaults or a backfill.
- **Don't** add `@@unique([recipeId, ingredientId])`. The same ingredient can legitimately appear twice in a recipe, such as butter for the base and butter for the topping.
- **Declare the trigram indexes in `schema.prisma`**, using `raw("gin_trgm_ops")` as above. An index that exists only in hand-written migration SQL looks like drift to Prisma, and every later `migrate dev` then generates a `DROP INDEX`. If such an index already exists under a different name, use `map:` to keep that name.
- After creating the migration, run `npx prisma migrate dev` again. It must report no changes.
- **Check the search query with `EXPLAIN`.** A GIN trigram index speeds up `ILIKE` and the `%` operator. It doesn't help `ORDER BY similarity(...)` or a `similarity(...) > x` filter, and an index on `name` doesn't help a query on `lower(name)`. At personal scale the index is nice-to-have, so don't contort the query for it.
- `sectionId` on RecipeIngredient waits for Phase 3.

- [x] Reset the dev database (ask first). Not needed: the dev and test databases had no rows.
- [x] Update `schema.prisma` to the target models
- [x] Create the migration: `npx prisma migrate dev --name phase1_ingredient_model`
- [x] Run `migrate dev` again and confirm there's no drift
- [x] **Give the seed an entry point (A8).** Added 2026-10-27 from Step 2. Today `npm run seed` and `npx prisma db seed` exit without seeding, so "the seed runs" below can't pass.
  - Put the entry point in its own file, such as `prisma/seeds/run.ts`. It creates a Prisma client, calls `assertSafeDatabase()` from Step 3 (which allows `_test` and `_dev`), runs `seed()`, then disconnects.
  - Keep it out of `base-seed.ts`. The test helpers import that file, and code that runs on import would seed during every test run.
  - Point both `npm run seed` and the `prisma.seed` setting in package.json at the new file, using `tsx` for both. The current `node --loader ts-node/esm` prints deprecation warnings on Node 22.
- [x] Update the seed to use the new fields: ordered lines, a line with a null quantity, a line with a note, and a range
- [x] Check that the tests still compile. Many will fail until Step 5, and that's expected

**Done when:** the migration is applied to both the dev and test databases, Prisma reports no drift, and the seed runs.

## Step 5: Update the API to match
**Goal:** the handlers enforce the new model and close the gaps the audit found.

### 5.1 Validation (D1, D2, A2, S3)
Rules for recipes:
- `name`: a trimmed string of 1–200 characters, required on POST and optional on PATCH.
- `description` and `instructions`: a string or null.
- `servings`: an integer of at least 1, defaulting to 1.
- `prepTime` and `cookTime`: an integer of at least 0, or null.

Rules for each ingredient line in a recipe:
- The ingredient reference keeps whatever style Step 2 found.
- `quantity` is a number greater than 0, or null.
- `quantityMax` is a number or null. It's only allowed when `quantity` is set, and must be at least `quantity`.
- `unit` is null, empty, or converted to a symbol on the D2 list. An unknown unit returns 400 with the list of allowed units.
- `note` is a string of up to 200 characters, or null.

Rules for ingredients:
- `name` is trimmed, lowercased and 1–100 characters long.

General rules:
- **Reject unknown fields**, for example with Zod's `.strict()`. Clients must not be able to set `id` or `createdAt`, and this allowlist is what makes S3 impossible.
- The server sets `orderIndex` from each line's position in the array. Clients never send it.
- A validation failure returns 400 with a message per field, using the existing error-response shape.

- [x] Put the units in their own module, such as `src/units.ts`, with a `canonicaliseUnit()` function. Write it so Phase 3's client can reuse it and Phase 6 can add conversion factors (F5).
- [x] Add a validation schema, or helper-based checks under D1, for every route.

### 5.2 Ingredient uniqueness (A1)
- [x] Remove the `findFirst` pre-check, which has a race condition, and let the unique constraint decide. Map P2002 to 409 for both POST and PATCH, ideally once, in the error handler.

### 5.3 Recipe writes
- [x] POST creates the recipe and its lines in a single nested write.
- [x] PATCH handles `ingredients` like this:
  - Absent: the lines are left untouched.
  - Present: **the whole list is replaced**, using `deleteMany` plus `create` in the same nested update, which Prisma runs atomically.
  - An empty array: all lines are removed.
- [x] Set `updatedAt: new Date()` explicitly on the recipe in every PATCH. The timestamp must change even when only the lines change, and `@updatedAt` can't be relied on for relation-only changes.
- [x] An unknown ingredient id in the body returns 400, not 404. Which Prisma error you get depends on the write style: P2003 for a raw `ingredientId`, P2025 for `connect`. Map whichever you use, or check the ids with a single `findMany` beforehand.
- [x] Return lines sorted with `orderBy: { orderIndex: 'asc' }`.
- [x] Optional, and ask me first: accept an ingredient `name` in a line and find-or-create it with `upsert` on the unique name. **Answered 2026-11-02: not now.** Revisit in Phase 3.

### 5.4 Search (A3)
- [x] `search` must be a single string, or the request gets a 400. Today `?search=a&search=b` causes a 500.
- [x] Trim the term, treat an empty term as no search, and cap it at 100 characters.
- [x] Escape `\`, `%` and `_` before building ILIKE patterns, so they match literally.
- [x] Use raw SQL only through the tagged-template `$queryRaw`.

### 5.5 Pagination and ordering (A7, D6)
- [x] Accept `limit` (default 50, maximum 100) and `offset` (default 0). Both must be non-negative integers, or the request gets a 400.
- [x] Order plain lists by name, then id as a tie-break. Order search results by rank, then name, then id. For the ranked search, apply `LIMIT` and `OFFSET` in the SQL.
- [x] Use the response shape chosen in D6.

### 5.6 Health check (A6)
- [ ] Replace `GET /` with `GET /api/health`. It runs `SELECT 1` through Prisma and returns 200 `{ "status": "ok" }`. If the database is unreachable, it returns 503 `{ "status": "error" }` with no error detail in the body.

### 5.7 Errors and CORS (S1, A2)
- [ ] Unknown errors return 500 with a generic message. Full details go only to the server logs, and no stack traces appear in responses.
- [ ] Read the allowed CORS origins from an environment variable (`CORS_ORIGINS`, comma-separated). If it's unset, allow no cross-origin access. Note for Phase 3: if the UI and API share one origin (the same `ts.net` host), CORS isn't needed at all.

**Done when:** every existing test is updated and passing, and a manual curl of each endpoint behaves as specified.

## Step 6: Fill in the missing tests (A4, A9)
Integration tests:
- [ ] PATCH an ingredient to a name that already exists → 409
- [ ] Two POSTs of the same new name → one 201 and one 409
- [ ] POST `" Onion "` → stored as `onion`
- [ ] Invalid `servings` (`"abc"`, `-1`, `1.5`) and invalid `prepTime` → 400
- [ ] Invalid `quantity`, `quantityMax` below `quantity`, or an unknown unit → 400
- [ ] A unit alias such as `"grams"` is stored as `g`
- [ ] An unknown field in the body → 400
- [ ] An unknown ingredient id in a recipe body → 400
- [ ] Line order is preserved, and null quantity, null unit and notes all come back unchanged
- [ ] A PATCH containing only `ingredients` changes `updatedAt`
- [ ] A PATCH without `ingredients` leaves the lines alone, and `ingredients: []` removes them
- [ ] `?search=a&search=b` → 400, and a `%` in the term matches literally
- [ ] Pagination: `limit` and `offset` work, the maximum limit is enforced, invalid values → 400, and the default order is stable
- [ ] `/api/health` → 200. A test for the 503 case is optional, if simulating a database outage is cheap

Unit tests:
- [ ] The validation schemas or helpers, `isPrismaError`, name normalisation, `canonicaliseUnit`, `assertSafeDatabase` and the ILIKE escaping
- [ ] Make CI report coverage, with no threshold yet. Set one once coverage settles

**Done when:** all tests pass locally and in CI. **Phase 1 is then complete.**

## Step 7: Update the docs
**Goal:** the docs match the code again.

**Why:** the design doc's quality section requires a README, API docs and schema docs, and the ERD is stale (A10, M1). Each spec segment is drafted first, and I paste them into the specs.

Spec segments, each written to `planning/spec-segments/`:
- [ ] `01-phase1-schema.md`: replaces the tables in technical spec §2.1 and its "Current Prisma Schema" block. Explain why quantity and unit are nullable, why names are unique and why lines have an order. Also correct the UUID rationale: UUIDs help with offline creation, but they aren't a security measure (M3).
- [ ] `02-api.md`: the Phase 1 parts of §3.1 and §3.2. Cover the health endpoint, pagination parameters and response shape, PATCH semantics, validation rules and a table of error codes.
- [ ] `03-testing.md`: §5, covering the separate test and dev databases, the guard, serial Jest runs, `globalSetup` and what unit tests cover.
- [ ] `04-dev-and-ci.md`: §6.1 (the Compose file) and §6.4 (CI) as they now stand.
- [ ] `05-phase-plan.md`: the design spec's phases, following the revised phase map. This needs D5.

In the repo, committed:
- [ ] A README covering setup, environment variables, commands, the test database and how to run everything
- [ ] An API reference at `docs/api.md`, listing every endpoint with its parameters, bodies, responses and error codes
- [ ] A new ERD, because the current PNG shows `Int` ids. Either redo it in the tool you used, or add a Mermaid `erDiagram` to `docs/`. Mermaid is plain text, so changes show up in diffs, and GitHub renders it.
- [ ] A corrected architecture diagram, with the arrows running Express → Prisma → PostgreSQL (M1)

Later-phase segments wait until just before their phase (see the Backlog).

**Done when:** the segments are drafted and I've pasted them in, and the README and API reference are committed.

## Step 8: Phase 2, the Pi with Tailscale
**Goal:** the API runs on the Pi, is reachable only over Tailscale HTTPS, survives reboots, and is backed up.

**Why:** setting up HTTPS from the start avoids redoing the network setup for the PWA (F1). How the Pi is set up decides whether you ever lose data (V4, T3).

### 8.1 Pi and operating system (V4)
- [ ] Install 64-bit Raspberry Pi OS (Lite is fine), booting from an SSD rather than an SD card
- [ ] Install Docker Engine with the Compose plugin, and turn on unattended security updates

### 8.2 Tailscale (F1, S1)
- [ ] Install Tailscale, sign in, and give the machine a bland name. The name ends up in public certificate-transparency logs as `<name>.<tailnet>.ts.net`
- [ ] In the Tailscale admin console:
  - **Disable key expiry** for the Pi. By default, device keys expire after 180 days and the device drops off your tailnet.
  - Turn on MagicDNS and **HTTPS certificates**.
- [ ] Run `tailscale serve --bg 3000`. It serves `https://<name>.<tailnet>.ts.net` and forwards to `127.0.0.1:3000`, and it keeps running across reboots

### 8.3 Production Compose file
- [ ] `api` service:
  - `ports: ["127.0.0.1:3000:3000"]`, so only the Pi itself can reach it
  - `restart: unless-stopped`
  - wait for the database with `depends_on` → `db` → `condition: service_healthy`
  - a healthcheck that calls `/api/health`
  - environment variables from a `.env` file on the Pi, never from git
- [ ] `db` service:
  - **no `ports:` entry at all**, since the API reaches it over the Compose network
  - a named volume, `restart: unless-stopped` and a `pg_isready` healthcheck
  - the same image version as dev (D4)
- [ ] In scripts, use `docker compose exec` and `docker compose run` with service names, rather than relying on `container_name`

### 8.4 Dockerfile
- [ ] Use a multi-stage build, and run the app as the non-root `node` user
- [ ] Base it on a Debian "slim" Node image rather than Alpine, and install `openssl` in it, because Prisma needs it
- [ ] Make the Prisma CLI available in the runtime image, because the deploy script runs `prisma migrate deploy` from it. Either move `prisma` into `dependencies` or add a dedicated migration stage
- [ ] Build the image on the Pi, where it's natively arm64. If you ever build it on another machine for the Pi, add the arm64 target to `binaryTargets` (Prisma 6)

### 8.5 Optional: check the Tailscale identity (S1)
- [ ] Add middleware that returns 403 unless the `Tailscale-User-Login` header equals the `ALLOWED_TAILSCALE_LOGIN` environment variable.
  - Exempt `/api/health`, because the deploy script calls it locally without the header.
  - This is only safe because the API listens on 127.0.0.1 alone. Anyone who could reach the port directly could forge the header.

### 8.6 Deploy script (T3)
This replaces the spec's script. That script's host shell expands `$POSTGRES_USER` and `$POSTGRES_DB` while they're unset, so `pg_dump` fails, the redirect has already emptied `backup.sql`, and the deploy carries on anyway. A sketch of the replacement:

```bash
#!/usr/bin/env bash
# scripts/deploy.sh: run on the Pi from anywhere inside the repo
set -euo pipefail
cd "$(dirname "$0")/.."

backup_dir="${BACKUP_DIR:-/srv/miseenplace/backups}"   # outside the repo
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup_dir"

# 1. Back up. The single quotes make the variables expand inside the container, where they're set.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$backup_dir/pre-deploy-$stamp.dump"
[ -s "$backup_dir/pre-deploy-$stamp.dump" ] || { echo "Backup is empty; aborting" >&2; exit 1; }

# 2. Update the code. --ff-only stops with an error instead of merging if the histories have diverged.
git pull --ff-only origin main

# 3. Build while the current version keeps serving (builds on ARM are slow)
docker compose build api

# 4. Run migrations with the new image before the new API starts
docker compose run --rm api npx prisma migrate deploy

# 5. Start the new version
docker compose up -d

# 6. Retry the health check; if it never passes, fail the deploy
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health > /dev/null; then
    echo "Deploy OK"; exit 0
  fi
  sleep 2
done
echo "Health check failed" >&2
docker compose logs --tail=100 api >&2
exit 1
```

- [ ] Write `scripts/deploy.sh` from the sketch, and test it twice

### 8.7 Backups (V4)
- [ ] Add a daily cron job that runs `pg_dump -Fc` through `docker compose exec -T`, saves the dump to the SSD and keeps 7 days of dumps (spec §6.2). Put the commands in a script, `scripts/backup.sh`, rather than in the crontab line itself
- [ ] Keep an encrypted copy off the Pi, for example with restic or rclone's crypt backend, on another machine or in cloud storage
- [ ] Back up the images directory as well, once Phase 3 adds images
- [ ] **Test a restore:** restore a dump into a scratch database, for example with `pg_restore -d miseenplace_restore_check`, and compare row counts with the live database

**Done when:**
- [ ] A phone connected to Tailscale gets a 200 from `https://<name>.<tailnet>.ts.net/api/health`
- [ ] From another device on the home network, `http://<pi-lan-ip>:3000` and port 5432 on the Pi both refuse connections
- [ ] After the Pi reboots, everything comes back without intervention
- [ ] A restore test has passed

## Phase 3 gate (before any UI code)
First, settle D7–D11. Then write the Phase 3 spec segments, taking in the design-review items that apply to Phase 3:
- F1: a single HTTPS origin
- F2: the gaps in timestamp-based sync
- F3: edit conflicts, and client-generated ids for offline creation
- F6: missing endpoints, namely instruction CRUD, attaching tags and equipment to recipes, and DELETE for sections, links and equipment
- F7: a `primaryImageId` on Recipe instead of an `isPrimary` flag on images
- S4: rules for image uploads
- F5: showing quantities as fractions, and sharing the units module with the client
- V2: Electron
- V3: splitting the phase

## Backlog (later phases)
| When | Items |
|---|---|
| Any time after Step 6 | M6: a JSON export of all data (small, and cheap insurance) |
| Phase 3 | See the Phase 3 gate |
| Phase 4 | Uptime and disk-space alerts, log rotation, and automated dependency updates (Dependabot or Renovate). V5: the Prisma upgrade, as its own task |
| Phase 5 | F7: the shopping-list tables must exist before Phase 5 can deliver shopping lists |
| Phase 6 | V1/D12: USDA FoodData Central. F5: unit conversion using ingredient densities. F7: fixes to the meal-plan and shopping-list schema, and ingredient categories. M5: safe URL import. M1: RecipeLink and timers each appear in two phases |

## Progress log
- **2026-09-27:** Plan created from the design review and the Phase 1 code audit. No code changed yet. Next: Step 1.
- **2026-10-27:** Planning documents moved into the repo, and `code-audit.md` rewritten from the code at `8e61e98`. Its A8 section already answers most of Step 2's checks, but Step 2 still records them here.
- **2026-10-27:** Step 1 done.
  - D1: Zod
  - D2: canonical unit list with aliases, in API code
  - D3: `prisma` and `@prisma/client` pinned to exactly 6.6.0 in package.json and the lockfile; installed versions unchanged
  - D4: Postgres 17, and the dev data is disposable
  - D5: Tailscale moves into Phase 2

  Next: Step 2.
- **2026-10-27:** Step 2 done. Docker Desktop wasn't running, so nothing touched a database. Each ❌ names the step that fixes it. "Proposed" means no task covers it yet.
  - ✅ **pg_trgm migration (A3):** `20260302213608_add_trigram_fuzzy_search` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and sorts after every table migration. Its GIN indexes exist only in SQL, so Step 4 declares them with `map:` (`recipe_name_trgm_idx`, `ingredient_name_trgm_idx`).
  - ❌ **Reset and seed guard (T1):** `cleanDatabase()` and `seed()` delete every row with no check on the database name → Step 3.
  - ✅ **Separate test database (T1):** `npm test` loads `.env.test` (`mydatabase_test`); dev is `mydatabase` on the same server. A bare `npx jest` would fall back to `.env`, which the Step 3 guard closes. Dev doesn't end in `_dev` yet → Step 3.
  - ❌ **How Jest runs (T1):** `npm test` already uses `--runInBand`. `prisma migrate deploy` runs in every file's `beforeAll` → Step 3 (`globalSetup`).
  - ❌ **Test discovery (A5):** files are named `*.test.ts`, but `npx jest --listTests` lists six: the three in `tests/` and their compiled copies in `dist/tests/`. `tests/helpers/jest-setup.ts` isn't loaded by `jest.config.js` → Step 3 (proposed).
  - ✅ **`req.body` into Prisma (S3):** no handler passes it through; every `data` object is built from named fields.
  - ✅ **Ingredient references:** by `ingredientId` only. `toRecipeIngredientCreateData` builds `{ ingredientId, quantity: quantity ?? 0, unit }` for a nested create, so a bad id gives P2003 → 400. Step 5.3 keeps this style.
  - ❌ **Error handler (A2):** unknown errors return a generic 500 with no stack trace in the body (run). Malformed JSON also returns 500 instead of 400 (run). P2002 isn't mapped anywhere → Steps 5.1, 5.2 and 5.7.
  - ❌ **Compose file (S2, M4):** `'5432:5432'` and `'3000:3000'` publish on every interface. Image `postgres:15` (D4 chose 17), obsolete `version` key (Compose warns about it), no healthcheck. Data is in the named volume `postgres-data`, not `./postgres-data`. The in-repo `postgres-data/` folder (Postgres 15, 71 MB) is unused leftover → Step 3 (ask before deleting anything).
  - ❌ **CI (T2):** still the SQLite workflow (`DATABASE_URL=file:./test.db` against a `postgresql` provider). No Postgres service or health check; never runs tests, lint or coverage; Node 18; `setup-node@v3` → Step 3. Run results not seen (no `gh` CLI).
  - ✅ **.gitignore (M4):** `.env*` (added during setup), `*postgres-data`, `*.db` and `dist/` are all covered.
  - ❌ **package.json:** scripts `dev`, `build`, `start`, `test`, `seed`. Prisma is pinned to 6.6.0 (Step 1), `npm ls` is clean and `npx tsc --noEmit` passes. No `engines` field or `.nvmrc` → Step 3. `zod` isn't installed → Step 5.1. `cors` isn't installed → Step 5.7, if needed. No ESLint or Prettier config, although Step 3's CI runs lint → Step 3 (proposed).
  - ✅ **CORS (S1):** no CORS middleware and no wildcard `cors()`. Step 5.7 adds the allowlist.
  - ❌ **README and API docs:** the README is stale (Node 18+, a missing `.env.example`, `GET /` as the health check, `npm run seed` described as working). There's no `docs/api.md` → Step 7.
  - ✅ **Commands and Code map:** updated in the local working notes.
  - Also confirmed by running:
    - `npm run seed` and `npx prisma db seed` both exit 0 without connecting, even with an unreachable `_test` URL, because the seed has no entry point. Step 4's "the seed runs" depends on this → Step 3 or 4 (proposed).
    - `GET /api/health` → 404 → Step 5.6.
    - `?search=a&search=b` → 500 (`TypeError` in `fuzzy-search.ts:52`) → Step 5.4.
  - Still to check once Docker is running, at the start of Step 3: a baseline `npm test`, `prisma migrate status` on both databases, whether the test database exists, and whether `migrate dev` would drop the trigram indexes.

  Next: Step 3.
- **2026-10-27:** The three "proposed" items from Step 2 are now tasks: **Test discovery (A5)** and **Lint (T2)** in Step 3, and **Give the seed an entry point (A8)** in Step 4.
- **2026-11-02:** Step 3: every task done locally. It isn't finished until CI is green twice, which needs the branch pushed.
  - **Found first:** this session's environment had `.env` loaded, so `DATABASE_URL` already pointed at the dev database. dotenv doesn't override existing variables, so the old `npm test` would have ignored `.env.test` and reset the dev database. Now closed three ways: `dotenv -o` in `npm test`, an override in `globalSetup`, and the guard.
  - **Databases:** Postgres 17.11 in Docker, published on `127.0.0.1` only, on a new volume `pgdata`. `miseenplace_dev` and `miseenplace_test` replace `mydatabase` and `mydatabase_test` in the env files. The old Postgres 15 data is untouched: the Docker volume `miseenplace_postgres-data` and the `postgres-data/` folder (ask before deleting).
  - **Baseline before any test changes:** 86 tests in 6 suites passed in 57 s. That's 43 tests run twice, because of the `dist/` copies.
  - **Checks deferred from Step 2:** dev migrations applied and up to date. The test database is migrated by `globalSetup`. `prisma migrate diff` confirms `migrate dev` would drop `ingredient_name_trgm_idx` and `recipe_name_trgm_idx` → Step 4.
  - **After:** `npm test` passed twice in a row: 53 tests in 4 suites (the 43 plus 10 guard tests) in about 11 s. A bare `npx jest` in the same shell also used `miseenplace_test`. `npm run lint` and `npx tsc --noEmit` are clean, and coverage is 88.6% of statements.
  - **Guard:** `cleanDatabase()` refuses a `_dev` URL before deleting anything, and a test proves it.
  - **Choices:**
    - `globalSetup` repeats the `_test` check inline, because Jest loads it outside its module mapping and it can't import the TypeScript guard.
    - `jest-setup.ts` is deleted, and the `testTimeout` option does its job.
    - CI also runs `npx tsc --noEmit`, because ts-jest only transpiles (`isolatedModules`) and type errors never fail the tests.
    - `engines.node` is `^22.13.0`, ESLint 10's minimum.
  - Not needed: the pg_trgm task, because Step 2 found the migration.
- **2026-11-02:** Step 3 done. CI passed twice in a row: run #3 on pull request #1, then run #4 on `main` after the merge. Runs #1 and #2 were the old SQLite workflow failing.
  - The dev database is already fresh (Postgres 17, migrations only, no rows), so Step 4's reset may not be needed.

  Next: Step 4.
- **2026-11-02:** Step 4 done.
  - **Reset:** not needed. Both databases had 0 rows and the same four migrations.
  - **Migration:** `20261102111623_phase1_ingredient_model`.
    - `migrate dev --name` stopped before writing anything. It wanted a yes to its unique-constraint warning, and the shell it ran in can't answer prompts.
    - So the SQL came from `prisma migrate diff --from-schema-datasource` (the dev database) `--to-schema-datamodel`, and was read before it was applied. Then `migrate dev` applied it.
    - A second `migrate dev` reported "Already in sync". That run also replays every migration into a shadow database, so the history and `schema.prisma` match.
    - `migrate deploy` applied it to `miseenplace_test`. Both databases report 5 migrations, up to date.
  - **Trigram indexes:** declared in `schema.prisma` with `map:`, so the migration has no `DROP INDEX` and they keep their names.
  - **Seed:**
    - `prisma/seeds/run.ts` is the entry point for `npm run seed` and `prisma db seed`, both through `tsx`. Both seeded `miseenplace_dev`. A URL ending in neither `_dev` nor `_test` is refused with exit code 1.
    - Beef Chili now has 10 ordered lines instead of 8. Newly linked: smoked paprika as a 1–2 tsp range, and cayenne pepper "to taste" with no quantity. Cumin and kidney beans stay unlinked.
    - The free-text units became a canonical unit plus a note: `clove` + "chopped", `can` + "drained", and a count with no unit + "diced".
    - An unknown ingredient name in the seed now throws, instead of silently dropping the line.
  - **Compile and tests:**
    - The tests and the seed compile. `npx tsc --noEmit` has one error, in `src/routes/recipes.ts`, which doesn't set `orderIndex` yet. Lint is clean.
    - `npm test`: 49 passed, 4 failed. The 4 are every recipe write with ingredients, all "Argument `orderIndex` is missing" → 500.
    - Step 5.3 fixes both. CI would fail on this commit alone.
  - **Search index (`EXPLAIN`, for Step 5.4):**
    - With sequential scans turned off, the current query still scans the whole table. `word_similarity(...) > 0.3` can't use an index, and because it's ORed with the `ILIKE`, neither half does.
    - `ILIKE` alone uses `recipe_name_trgm_idx`. So does the operator form `'beef' <% name OR name ILIKE ...`, as a BitmapOr over the index.
    - At personal scale this is optional.
  - **Seen, not acted on:**
    - `prisma generate` warns that a generator with no `output` path is deprecated in Prisma 7. That belongs to the later upgrade (V5), not now (D3).
    - `ts-node` is now unused. Only the old seed command used it.

  Next: Step 5.
