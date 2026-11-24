> Created on 27 September 2026. This is the live copy: progress is ticked off here as each step is done.

# Mise en place: hardening plan (Phase 1 to Phase 3c)

> **Status**
> - Current step: **Step 17: saving offline, and uploading**, ready to start once one question is settled: offline edits need each recipe's ETag, which the snapshot doesn't carry yet (see the Progress log for 2026-11-24). Step 16 is done (2026-11-24), with CI to be confirmed when its PR opens; Step 15 merged as PR #18, CI green. Phase 3a is done (2026-11-23), and D15 was settled on 2026-11-24 (offline drafts, in 3c, with 3c before 3b). Step 8 waits only on the SSD (8.1, about a month away); its images backups (8.7) move into 3b with the images
> - Last updated: 2026-11-24 (Step 16: the offline copy)
> - Blockers: the SSD for 8.1, about a month away

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
| D7 | Electron | **Drop it or defer it.** An installed PWA already covers the desktop (V2) | Phase 3 gate | **Decided 2026-11-22: drop it.** The installed PWA is the desktop app; Electron can come back if a real need appears |
| D8 | Sync design | **A full snapshot with an ETag first.** Add delta sync with tombstones only if it's ever needed (F2) | Phase 3 gate | **Decided 2026-11-22: a full snapshot with an ETag.** Delta sync only if it's ever needed |
| D9 | Offline editing | **Read-only offline** to begin with (F3) | Phase 3 gate | **Decided 2026-11-22: read-only offline.** Editing waits for a connection. **Revised 2026-11-24 by D15:** recipes can be created and edited offline |
| D10 | Split Phase 3 | **Yes, into three:** 3a is the UI plus cooking mode on the Phase 1 schema; 3b is structured instructions, images and tags; 3c is offline support (V3) | Phase 3 gate | **Decided 2026-11-22: three parts, as recommended.** 3b also takes sections, equipment and the missing endpoints (F6). **Order changed 2026-11-24 by D15:** 3a, then 3c, then 3b |
| D11 | Image upload rules | Allowed types, size and pixel caps, re-encoding (S4) | Phase 3 gate | **Decided 2026-11-22:** JPEG, PNG and WebP, recognised from the contents (SVG, GIF and HEIC rejected). At most 15 MB and 50 megapixels, checked before decoding. Each image is turned upright, then re-encoded with sharp to WebP at 2000 px on the long side, plus a 400 px thumbnail, with all metadata stripped. The original isn't kept. Server-generated filenames, 10 images per recipe, stored in a Docker volume that's backed up with the database |
| D12 | Nutrition data source | **USDA FoodData Central** as the primary source. Use Spoonacular only for live, uncached extras (V1) | Phase 6 | Deferred |
| D13 | Styling | **Plain CSS with CSS Modules**, built into Vite. Nothing new to learn or upgrade, styles are scoped to each component, and CSS custom properties hold the sizes and colours cooking mode and printing override. Alternatives: Tailwind (utility classes in the markup, quick once learned) or a component library such as Mantine (ready-made forms and dialogs, but heavier and opinionated) | Step 10 | **Decided 2026-11-23: CSS Modules.** Plain CSS, one `*.module.css` file per component with its class names scoped to it, and the theme's colours and sizes as CSS custom properties. No Tailwind or component library. Settled after the UI wireframes |
| D14 | Timer alerts when the app isn't on screen | **Web Push from the Pi.** On Android, Firefox pauses a page soon after you switch away, so the page alone can't ring at zero. Instead, the app tells the Pi when a timer starts, and at zero the Pi sends a push, which the phone shows as a notification with sound and vibration, whatever app is open. It needs notification permission (asked once, at the first timer), VAPID keys in the Pi's `.env`, a small table of running timers so a restart can't lose one (3a's only schema change), and a connection at that moment. The push travels encrypted through Mozilla's push service. Firefox for Android has had push bugs with installed apps, so the first task would be a quick test on your phone. Alternative: timers ring only while the app is on screen, which cooking mode keeps it, and background alerts wait for Phase 5, which already lists push | Step 13 | **Decided 2026-11-22: on screen only, for now.** Timers ring while the app is on screen, and a note by them says so. Alerts while another app is open wait for Phase 5's push work |
| D15 | Offline edits (revisits D9) | **Offline drafts, as part of 3c, with 3c built before 3b.** Four levels: (0) keep D9, read-only; (1) offline drafts, where a recipe created or edited offline is kept on the phone and uploads by itself when the Pi answers, with the 412 check for changes made elsewhere; (2) a full offline queue that also takes deletes and ingredient changes, with conflicts shown side by side, about twice the work of 1; (3) automatic merging (CRDTs), far more than one person with two devices needs. 1 covers what the phone is used for offline, jotting down a recipe or tweaking one while cooking, and leaves out the changes that are rare and riskiest to replay | Before 3c | **Decided 2026-11-24: offline drafts, in 3c, with 3c before 3b, as recommended.** Called *waiting changes* in the specs. Creating and editing recipes work offline; deleting recipes and renaming or deleting ingredients still need a connection. New recipes get their id on the device, so a retried upload can't create one twice (3c's one API change). Raised 2026-11-23: in Step 14's phone check, Android ran only one VPN at a time, so Tailscale and Proton VPN take turns and the phone is often off the tailnet |

## Revised phase map
| Phase | Original | Proposed |
|---|---|---|
| 1 | Backend API | Backend API **plus hardening** (Steps 1–7 below) |
| 2 | Pi on the home network | The Pi **plus Tailscale HTTPS** from day one (Step 8) |
| 3 | Desktop UI (a very large phase) | The UI, gated by D7–D11 and split into 3a, 3b and 3c (D10), built in the order 3a, 3c, 3b (D15) |
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
- [x] Replace `GET /` with `GET /api/health`. It runs `SELECT 1` through Prisma and returns 200 `{ "status": "ok" }`. If the database is unreachable, it returns 503 `{ "status": "error" }` with no error detail in the body.

### 5.7 Errors and CORS (S1, A2)
- [x] Unknown errors return 500 with a generic message. Full details go only to the server logs, and no stack traces appear in responses.
- [x] Read the allowed CORS origins from an environment variable (`CORS_ORIGINS`, comma-separated). If it's unset, allow no cross-origin access. Note for Phase 3: if the UI and API share one origin (the same `ts.net` host), CORS isn't needed at all.

**Done when:** every existing test is updated and passing, and a manual curl of each endpoint behaves as specified.

## Step 6: Fill in the missing tests (A4, A9)
Integration tests:
- [x] PATCH an ingredient to a name that already exists → 409
- [x] Two POSTs of the same new name → one 201 and one 409
- [x] POST `" Onion "` → stored as `onion`
- [x] Invalid `servings` (`"abc"`, `-1`, `1.5`) and invalid `prepTime` → 400
- [x] Invalid `quantity`, `quantityMax` below `quantity`, or an unknown unit → 400
- [x] A unit alias such as `"grams"` is stored as `g`
- [x] An unknown field in the body → 400
- [x] An unknown ingredient id in a recipe body → 400
- [x] Line order is preserved, and null quantity, null unit and notes all come back unchanged
- [x] A PATCH containing only `ingredients` changes `updatedAt`
- [x] A PATCH without `ingredients` leaves the lines alone, and `ingredients: []` removes them
- [x] `?search=a&search=b` → 400, and a `%` in the term matches literally
- [x] Pagination: `limit` and `offset` work, the maximum limit is enforced, invalid values → 400, and the default order is stable
- [x] `/api/health` → 200. A test for the 503 case is optional, if simulating a database outage is cheap

Unit tests:
- [x] The validation schemas or helpers, `isPrismaError`, name normalisation, `canonicaliseUnit`, `assertSafeDatabase` and the ILIKE escaping
- [x] Make CI report coverage, with no threshold yet. Set one once coverage settles

**Done when:** all tests pass locally and in CI. **Phase 1 is then complete.**

## Step 7: Update the docs
**Goal:** the docs match the code again.

**Why:** the design doc's quality section requires a README, API docs and schema docs, and the ERD is stale (A10, M1). Each spec segment is drafted first, and I paste them into the specs.

Spec segments, each written to `planning/spec-segments/`:
- [x] `01-phase1-schema.md`: replaces the tables in technical spec §2.1 and its "Current Prisma Schema" block. Explain why quantity and unit are nullable, why names are unique and why lines have an order. Also correct the UUID rationale: UUIDs help with offline creation, but they aren't a security measure (M3).
- [x] `02-api.md`: the Phase 1 parts of §3.1 and §3.2. Cover the health endpoint, pagination parameters and response shape, PATCH semantics, validation rules and a table of error codes.
- [x] `03-testing.md`: §5, covering the separate test and dev databases, the guard, serial Jest runs, `globalSetup` and what unit tests cover.
- [x] `04-dev-and-ci.md`: §6.1 (the Compose file) and §6.4 (CI) as they now stand.
- [x] `05-phase-plan.md`: the design spec's phases, following the revised phase map. This needs D5.

In the repo, committed:
- [x] A README covering setup, environment variables, commands, the test database and how to run everything
- [x] An API reference at `docs/api.md`, listing every endpoint with its parameters, bodies, responses and error codes
- [x] A new ERD, because the current PNG shows `Int` ids. Either redo it in the tool you used, or add a Mermaid `erDiagram` to `docs/`. Mermaid is plain text, so changes show up in diffs, and GitHub renders it.
- [x] A corrected architecture diagram, with the arrows running Express → Prisma → PostgreSQL (M1)

Later-phase segments wait until just before their phase (see the Backlog).

**Done when:** the segments are drafted and I've pasted them in, and the README and API reference are committed.

## Step 8: Phase 2, the Pi with Tailscale
**Goal:** the API runs on the Pi, is reachable only over Tailscale HTTPS, survives reboots, and is backed up.

**Why:** setting up HTTPS from the start avoids redoing the network setup for the PWA (F1). How the Pi is set up decides whether you ever lose data (V4, T3).

### 8.1 Pi and operating system (V4)
- [ ] Install 64-bit Raspberry Pi OS (Lite is fine), booting from an SSD rather than an SD card. **On the SD card for now (2026-11-22):** the SSD is about a month away. "Moving to an SSD" in `docs/deployment.md` covers the move; tick this once the Pi boots from the SSD
- [x] Install Docker Engine with the Compose plugin, and turn on unattended security updates. Docker is in (`get-docker.sh`, Docker's own package repository). Unattended upgrades were installed and enabled on 2026-11-22, after section 1 step 4 of the runbook had been skipped. They don't update Docker or reboot the Pi, so run `sudo apt full-upgrade` by hand now and then

### 8.2 Tailscale (F1, S1)
- [x] Install Tailscale, sign in, and give the machine a bland name. The name ends up in public certificate-transparency logs as `<name>.<tailnet>.ts.net`. It's `kitchen-pi`
- [x] In the Tailscale admin console:
  - **Disable key expiry** for the Pi. By default, device keys expire after 180 days and the device drops off your tailnet.
  - Turn on MagicDNS and **HTTPS certificates**.

  MagicDNS and HTTPS work, because the phone reaches the `ts.net` address over HTTPS, and `kitchen-pi` shows **Expiry disabled**. The phone keeps its key expiry, which is right for a device that can be lost
- [x] Run `tailscale serve --bg 3000`. It serves `https://<name>.<tailnet>.ts.net` and forwards to `127.0.0.1:3000`, and it keeps running across reboots. Funnel is off: the status says "tailnet only"

### 8.3 Production Compose file
- [x] `api` service:
  - `ports: ["127.0.0.1:3000:3000"]`, so only the Pi itself can reach it
  - `restart: unless-stopped`
  - wait for the database with `depends_on` → `db` → `condition: service_healthy`
  - a healthcheck that calls `/api/health`
  - environment variables from a `.env` file on the Pi, never from git
- [x] `db` service:
  - **no `ports:` entry at all**, since the API reaches it over the Compose network
  - a named volume, `restart: unless-stopped` and a `pg_isready` healthcheck
  - the same image version as dev (D4)
- [x] In scripts, use `docker compose exec` and `docker compose run` with service names, rather than relying on `container_name`

### 8.4 Dockerfile
- [x] Use a multi-stage build, and run the app as the non-root `node` user
- [x] Base it on a Debian "slim" Node image rather than Alpine, and install `openssl` in it, because Prisma needs it
- [x] Make the Prisma CLI available in the runtime image, because the deploy script runs `prisma migrate deploy` from it. Either move `prisma` into `dependencies` or add a dedicated migration stage
- [x] Build the image on the Pi, where it's natively arm64. If you ever build it on another machine for the Pi, add the arm64 target to `binaryTargets` (Prisma 6)

### 8.5 Optional: check the Tailscale identity (S1)
- [x] Add middleware that returns 403 unless the `Tailscale-User-Login` header equals the `ALLOWED_TAILSCALE_LOGIN` environment variable. **Answered 2026-11-02: not now.** Tailscale already limits access to your own devices; revisit before sharing the Pi with anyone.
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

- [x] Write `scripts/deploy.sh` from the sketch, and test it twice. Written, and run twice against a local copy of the production stack. On the Pi, the first deploy and a second run on 2026-11-22 both ended `Deploy OK`

### 8.7 Backups (V4)
- [x] Add a daily cron job that runs `pg_dump -Fc` through `docker compose exec -T`, saves the dump to the SSD and keeps 7 days of dumps (spec §6.2). Put the commands in a script, `scripts/backup.sh`, rather than in the crontab line itself. The script is written and tested locally; the cron line is in `docs/deployment.md`. The line was added to the Pi's crontab on 2026-11-22 (03:30 daily); its first run is on 2026-11-23
- [x] Keep an encrypted copy off the Pi, for example with restic or rclone's crypt backend, on another machine or in cloud storage. **Answered 2026-11-22: Backblaze B2, with restic.** `scripts/offsite.sh` and section 7 of `docs/deployment.md`. The first copy went up on 2026-11-22, and a restore from it passed the restore check
- [ ] Back up the images directory as well, once Phase 3 adds images
- [x] **Test a restore:** restore a dump into a scratch database, for example with `pg_restore -d miseenplace_restore_check`, and compare row counts with the live database. `scripts/restore-check.sh` does this. It passed locally, and on the Pi on 2026-11-22

**Done when:**
- [x] A phone connected to Tailscale gets a 200 from `https://<name>.<tailnet>.ts.net/api/health`
- [x] From another device on the home network, `http://<pi-lan-ip>:3000` and port 5432 on the Pi both refuse connections
- [x] After the Pi reboots, everything comes back without intervention
- [x] A restore test has passed

## Phase 3 gate (before any UI code)
First, settle D7–D11 (**done 2026-11-22**, all as recommended). Then write the Phase 3 spec segments (**done 2026-11-22**, applied to both specs), taking in the design-review items that apply to Phase 3:
- F1: a single HTTPS origin
- F2: the gaps in timestamp-based sync
- F3: edit conflicts, and client-generated ids for offline creation
- F6: missing endpoints, namely instruction CRUD, attaching tags and equipment to recipes, and DELETE for sections, links and equipment
- F7: a `primaryImageId` on Recipe instead of an `isPrimary` flag on images
- S4: rules for image uploads
- F5: showing quantities as fractions, and sharing the units module with the client
- V2: Electron
- V3: splitting the phase

## Phase 3a: the UI and cooking mode
Phase 3a builds the web client on the Phase 1 schema (D10). The specs are the reference: technical spec §3.2 (Phase 3a), §3.4 and §5.6, and the design spec's Phase 3a. Every step ends with its tests passing in CI, so the app works at the end of each step, not only the last.

**Phase 3a is done when** the design spec's 3a success criteria are met:
- Recipes can be found, read, created, edited and deleted from a phone and a laptop
- The app installs from Firefox on Android and opens from the Home Screen
- Cooking mode keeps the screen on through a whole recipe
- With the app open on both, a recipe added on the laptop appears on the phone as soon as the phone's app comes back to the front, or Refresh is tapped
- End-to-end tests cover the main flows in Firefox and Chromium, at phone and desktop sizes, in CI

## Step 9: Shared code and API changes for the client
**Goal:** the API is ready for a browser client, and the code both sides need lives in `shared/`.

**Why:** these are the only server changes 3a needs (§3.2, Phase 3a). They're easier to test before any screen depends on them.

### 9.1 `shared/` (F5)
- [x] Move `src/units.ts` to `shared/units.ts`, and update its imports and tests. The Dockerfile must copy `shared/` into its build stage, and the server must still build to `dist/src/server.js`
- [x] Add `shared/quantity.ts`:
  - `formatQuantity()`: fractions to the nearest eighth for spoon and cup measures and for counts, decimals for metric units, and "2–3" for a range
  - `parseQuantity()`: reads "1 1/2", "1½", "1.5" and "2-3" into `quantity` and `quantityMax`. Anything else returns an error message rather than a guess
- [x] Unit tests for both, as `test.each` tables in `tests/`, including the edges: 0.33 as ⅓ and 0.66 as ⅔, values nowhere near an eighth (shown as decimals), and inputs such as "1/0", "0" and "abc"

### 9.2 API changes (F3)
- [x] An unknown path under `/api` returns 404 `{ "error": "Not found." }` instead of Express's HTML page
- [x] `GET /api/recipes/:id` returns a strong `ETag` made from `updatedAt`. `PATCH` and `DELETE` honour `If-Match`, returning 412 `{ "error": "The recipe has changed since it was loaded." }` when it's stale. Without `If-Match` there's no check, so curl and scripts keep working
- [x] Integration tests: the 404; a matching `If-Match` succeeds; a stale one gets 412 and changes nothing, on both PATCH and DELETE; the ETag changes after every PATCH, including one that only replaces the lines
- [x] `docs/api.md`: the 404, `ETag` and `If-Match`

**Done when:** all tests pass locally and in CI, and the API reference describes the changes.

## Step 10: The client's skeleton, served by the API
**Goal:** an empty app shell runs in development and from the production image, with CI and end-to-end tests ready for the later steps to add to.

**Why:** setting up the build, serving, CI and Playwright once, before any screens, means each feature step only adds its own code and tests.

Before starting (done 2026-11-23): the UI wireframes, made and reviewed together, and D13, answered as CSS Modules. The wireframes are a canvas artifact, not in the repo; the 2026-11-23 Progress log entry records what they settled.

### 10.1 The client
- [x] Create `web/` with Vite, React and TypeScript in strict mode, with its own `package.json` and lockfile (§3.4). Keep the API's `tsc` and ESLint away from `web/`: the root `tsconfig.json` has no `include` or `exclude` yet, so it would try to compile the client
- [x] React Router, with placeholders for the 3a routes: `/`, `/recipes/new`, `/recipes/:id`, `/recipes/:id/edit`, `/options` and `/options/ingredients`. The wireframe review made cooking mode a switch on the recipe page (no `/cook` route) and moved Ingredients under Options
- [x] TanStack Query, and one small API module that handles JSON in and out, an error type carrying the API's `error` and `fields`, `ETag` and `If-Match`, and `X-Total-Count`
- [x] Import `shared/` from the client. Vite has to be allowed to read files outside `web/`
- [x] Development: Vite on port 5173, forwarding `/api` and `/media` to the API on port 3000, so development is same-origin like production (F1). Root scripts run, build and test the client from the repo root
- [x] ESLint for the client, with the React hooks rules. Vitest with Testing Library, starting with a test of the API module's error handling
- [x] CSS Modules (D13): one `*.module.css` per component, plus one global stylesheet holding the theme as CSS custom properties (light and dark, following the system or the Options choice; text size; spacing). Cooking mode and printing override those properties later

### 10.2 Serving it (F1)
- [x] Express serves `web/dist`. Files with a content hash in their name are cached for a year. `index.html`, and later the service worker, are always revalidated. Any other GET outside `/api` and `/media` gets `index.html`, so deep links load the app. API tests cover all three
- [x] Dockerfile: a stage that builds the client. The API image copies in only the built files
- [x] Check the production image locally: `/`, a deep link, and `/api/health`. Run with `docker run` on the dev Compose network against `miseenplace_dev` rather than under a throwaway project, so no new volume was made

### 10.3 Tests in CI
- [x] Playwright, with Firefox and Chromium at a phone size and a desktop size, against the built client served by the API. It uses a `_test` database, reset to the base seed before each test (§5.6), and refuses any other, so the T1 guard applies
- [x] One smoke test: the app loads at `/` and at a deep link, in all four combinations
- [x] CI: the client's lint, type-check and unit tests, then Playwright, alongside the API's job

**Done when:** the shell loads in development and from the production image, and CI runs and passes the API tests, the client's checks and the Playwright smoke test.

## Step 11: Reading recipes, and keeping devices in step
**Goal:** any recipe can be found and read comfortably on a phone, and an open app picks up changes made elsewhere.

**Why:** reading on the phone while cooking is the main use. Doing reading before editing gives a usable app early.

- [x] Lighter lists: `GET /api/recipes` drops the ingredient lines (§3.2, Phase 3a), so the client can load page after page quickly. Update the API tests and `docs/api.md`
- [x] Recipe list: the API's fuzzy search, more loading automatically as you scroll (no button), and empty and no-results states. Rows leave room for 3b's tag pills and thumbnail, and become tiles on a desktop
- [x] Recipe page: ingredients through `formatQuantity()`, the method from `instructions`, and servings and times. A ⋮ menu (Edit, Print, Delete) on the page and on each list row, wired up in Steps 12 and 13. The cooking mode switch moved to Step 13, where it gets its wake lock: a switch that did nothing would only mislead
- [x] Options page: theme (system, light or dark) and text size, saved on the device, and the connection's state. Its Advanced section opens Ingredients: list and search, with renaming and deleting in Step 12
- [x] Phone first: readable one-handed, with large tap targets and text that scales with the browser's font size. Semantic HTML, labelled controls and visible focus (§3.4)
- [x] Keeping devices in step (§3.4):
  - refetch when the app opens, comes back to the front or reconnects
  - a Refresh button
  - a recipe deleted elsewhere shows "This recipe was deleted" rather than an error
- [x] Loading and error states, including "Can't reach the server"
- [x] Component tests for the list and the recipe page
- [x] Playwright:
  - find a recipe by search and open it, and scroll the list until the next page loads
  - with two browser contexts standing in for the laptop and the phone, a recipe added through the API in one appears in the other when that one comes back to the front, and when Refresh is pressed

**Done when:** the tests pass in CI.

## Step 12: Editing recipes and ingredients
**Goal:** recipes and ingredients can be created, changed and deleted from the app, and an edit on one device can't silently overwrite one made on another (F3).

**Why:** with reading in place, editing completes the everyday use, and it's where the API's validation and `If-Match` meet the UI.

- [x] Recipe editor, for create and edit: name, description, servings, times and instructions
- [x] Ingredient lines:
  - every line shown, each on one row: Amount, Ingredient and a ⋮ menu (Move up, Move down, Add note, Remove) that works by touch and keyboard. A note shows under its line only when it has one
  - one Amount box per line, with the amount and unit typed together ("100 g", "1½ tbsp", "2-3"). A new `parseAmount()` in `shared/quantity.ts` reads it, canonicalising the unit, and errors show inline
  - an ingredient picker that searches as you type, and can create a missing ingredient on the spot
- [x] The Ingredients and Method sections collapse, to jump between them
- [x] The API's `fields` errors shown next to their inputs, including line errors such as `ingredients.2.unit`
- [x] Saving sends `If-Match`. A 412 says the recipe changed elsewhere and offers to reload it
- [x] Deleting a recipe, from its ⋮ menu or the bottom of the editor, always after a confirmation
- [x] Ingredients, under Options › Advanced: rename (409 when the name is taken) and delete (409 says it's in use)
- [x] A warning before leaving the editor with unsaved changes
- [x] Tests: `parseAmount()` as `test.each` tables in Jest; component tests for the line editor, amount parsing in the form, and mapping `fields` onto inputs
- [x] Playwright:
  - create a recipe with lines and a new ingredient, edit it, and delete it
  - get the 412 prompt after changing the recipe in a second context
  - rename an ingredient

**Done when:** the tests pass in CI.

## Step 13: Cooking mode, printing and installing
**Goal:** cooking mode keeps the screen on while you read and scroll a recipe, small timers are there when a wait needs one, recipes print cleanly, and the app installs from Firefox on Android.

**Why:** these are what make it a kitchen app rather than a website, and the install is what later carries offline reading (3c).

### 13.1 Cooking mode
- [x] A cooking mode switch on the recipe page. The page itself doesn't change: the whole recipe stays readable and scrollable (§3.4)
- [x] While it's on, the Screen Wake Lock keeps the screen on. The lock is taken again whenever the page becomes visible, and released when the switch is turned off or you leave the recipe. If the API is missing, the switch says the screen may sleep
- [x] Timers, for mid-length waits:
  - a small button adds one, with a length and an optional label, and several can run at once
  - running timers are small chips at the edge of the screen, and never cover the recipe
  - one that finishes plays a sound, vibrates where supported, and grows until dismissed
  - each works from its end time rather than counting ticks, so it stays right if the screen locks
  - timers ring only while the app is on screen (D14), and a short note by them says so. Alerts while another app is open come in Phase 5
- [x] A timer sound switch in Options, with a test button
- [x] Component tests for the timers, with fake timers. Playwright: turn cooking mode on and off, and run two timers at once

### 13.2 Printing
- [x] A print stylesheet: the recipe's name, ingredients and method, without navigation, buttons or a footer. Checked in the print preview of Firefox and Chromium. Chromium was checked here, as a PDF from the production image. For Firefox, Playwright checks the print styles in CI; its print preview itself is checked with Step 14's print from the laptop

### 13.3 Installing
- [x] vite-plugin-pwa: the manifest (name, short name, icons, theme colour, `display: standalone`, start URL) and a service worker that caches the app's own files, so the app opens without a connection. Offline data comes in 3c
- [x] Icons: a simple mark at the sizes the manifest needs, including a maskable one for Android
- [x] A new deploy is picked up the next time the app starts. `index.html` and the service worker are always revalidated (Step 10)
- [x] Playwright: the manifest is valid, and the service worker registers

**Done when:** the tests pass in CI, and the production image installs as an app in Chromium on this PC.

## Step 14: Deploy, and check on the phone (Phase 3a done)
**Goal:** Phase 3a runs on the Pi and meets its success criteria on your phone.

**Why:** Playwright's Firefox is the desktop build of the engine. Installing, the wake lock and the feel of the app need the real phone.

- [x] Merge to `main`, then run `scripts/deploy.sh` on the Pi
- [x] On your phone, in Firefox for Android (you):
  - install the app from Firefox's menu, and open it from the Home Screen
  - find, read, create, edit and delete a recipe
  - follow a whole recipe with cooking mode on, and add a timer or two to check they stay out of the way. If the screen sleeps, Firefox for Android lacks the wake lock: cooking mode should say so, and we then choose between a fallback and using Chrome for cooking
  - with the app open on the phone and the laptop, add a recipe on the laptop, bring the phone's app back to the front, then try Refresh
- [x] Print a recipe from the laptop. Done from Edge: this PC's Firefox can't reach the tailnet while Proton VPN tunnels it
- [x] Docs: the README's development section (running the client, the root scripts, Playwright), `docs/architecture.md` (the API serving the client), and `docs/deployment.md` if anything changed
- [x] Tick the boxes, then update the Status block and the Progress log

**Done when:** every 3a success criterion above is met, and CI is green. **Phase 3a is then complete.** 3b's steps are written next, the same way. (D15 changed that: 3c comes first, below.)

## Phase 3c: offline use
Phase 3c comes before 3b (D15). Each device keeps a full snapshot of the data (D8), so every recipe can be read and cooked from with no connection. Recipes can also be created and edited offline: the change waits on the device and uploads by itself once the Pi can be reached (D9, revised by D15). Deleting recipes, and renaming or deleting ingredients, still need a connection. There's no schema change. The specs are the reference: technical spec §3.2 (Phase 3c), §3.3, §3.4 ("Offline" and "Editing offline") and §5.6, and the design spec's Phase 3c. As in 3a, every step ends with its tests passing in CI.

**Phase 3c is done when** the design spec's 3c success criteria are met:
- With the phone in airplane mode, the app opens from the Home Screen, any recipe opens, and cooking mode works
- The same holds weeks after the app was last opened, with the copy from its last refresh
- If the first refresh fails and the connection comes back later, the copy updates without restarting the app
- A recipe deleted on the laptop disappears from the phone at its next refresh
- With the phone off the tailnet, a new recipe and an edit to another show on the phone at once, survive the app being closed, and reach the laptop once the phone is back on the tailnet, with no extra taps
- An offline edit to a recipe changed on the laptop meanwhile asks which to keep, and nothing is lost whichever is chosen
- A connection lost partway through an upload never creates a recipe twice

## Step 15: The snapshot, and ids chosen by the client
**Goal:** the API serves everything a device needs offline in one cacheable response, and accepts a new recipe's id from the client.

**Why:** these are 3c's only server changes (§3.2, Phase 3c). As in Step 9, they're easier to test before the client depends on them.

- [x] `GET /api/sync` returns `{ recipes, ingredients }`, each recipe as `GET /api/recipes/:id` returns it (§3.3). It's deterministic: every array is sorted (recipes and ingredients by name, then id; lines by `orderIndex`), and the body has no timestamp of its own, so the same data always gives the same bytes. `tags` and `equipment` join it in 3b
- [x] Its `ETag` is a SHA-256 hash of the body. `If-None-Match` with the current one gets a 304 with no body
- [x] Gzip for the app's responses, through the `compression` package. That's a new dependency, named here as the working rules ask. It's applied to the whole app, so the client's files gain it too, and images, already compressed, are skipped. Whether `tailscale serve` passes it through to the phone can only be checked once it's deployed, so that check moved to Step 19
- [x] `POST /api/recipes` accepts an optional `id`, a UUID. A taken id gets 409 `{ "error": "A recipe with that id already exists." }` and changes nothing. `PATCH` still refuses `id`
- [x] Integration tests:
  - the snapshot's shape and order
  - the same data gives the same ETag; a new recipe, an edit, a delete and an ingredient rename each give a new one
  - a 304 for a matching `If-None-Match`
  - a deleted recipe is missing from the next snapshot
  - a gzip response when the request accepts it
  - `POST` with an id; a taken id (409, nothing changed); an id that isn't a UUID (400); `id` on `PATCH` (400)
- [x] `docs/api.md`: `/api/sync`, the `id` on create, and compression

**Done when:** all tests pass locally and in CI, and the API reference describes the changes.

## Step 16: The offline copy
**Goal:** every recipe can be found, read and cooked from with no connection, weeks after the app was last opened.

**Why:** reading offline is the base that offline editing builds on, and on its own it already covers cooking with the phone off the tailnet.

- [x] The store: the latest snapshot in IndexedDB, through idb-keyval (a new dependency, named in §3.4), as one record with its ETag and when it was fetched. It has no expiry, and it's replaced only once a complete newer snapshot has arrived. TanStack Query's own persistence isn't used for it, because it drops anything older than a day by default
- [x] Refreshing, with `If-None-Match`: at the moments the app already refetches (it opens, comes to the front, reconnects, or saves something), and from Refresh. A failed refresh is retried while the app is on screen, after 15 seconds and then at doubling intervals up to every 5 minutes. The browser's "online" signal isn't trusted alone, since the phone can have a network while the Pi is out of reach
- [x] When the Pi can't be reached, the list, search, the recipe page, cooking mode and Options › Ingredients read from the copy, with a banner saying so and how old the copy is. Search then matches names on the device
- [x] Options › "Offline copy": how many recipes it holds, when it was last refreshed, whether storage is protected, and the Protect button. `navigator.storage.persist()` is called from the tap, as Firefox requires
- [x] Saving while offline still says "Can't reach the server" until Step 17
- [x] Unit tests for the store, with fake time: a snapshot fetched 60 days earlier is still served offline; a failed or partial refresh leaves the copy untouched; only a complete one replaces it; the retry schedule
- [x] Component tests: the pages read from the copy, the banner, and the Offline copy line
- [x] Playwright:
  - load the app, go offline (`context.setOffline(true)`), then open recipes, search and use cooking mode. Reload while still offline, a fresh start from the copy, and check again
  - come back online, and see a change made elsewhere arrive
  - block `/api/sync`, unblock it, and check the retry gets the new snapshot without a restart

**Done when:** the tests pass in CI.

## Step 17: Saving offline, and uploading
**Goal:** recipes can be created and edited with the Pi out of reach, and the changes reach it by themselves later (D15).

**Why:** Step 14 showed the phone is often off the tailnet. Saving offline is the main thing D15 adds.

- [ ] Every new recipe gets its id on the device (`crypto.randomUUID()`), online or off, so there's only one way to create a recipe
- [ ] Save tries the Pi first. If it can't be reached (no answer, or a 502 or 504 from Tailscale), the change is kept in IndexedDB as a waiting change, and the editor closes as it does after any save
- [ ] At most one waiting change per recipe: editing a recipe that has one edits that version, and keeps the ETag it started from. Waiting changes survive a reload and the app being closed
- [ ] Waiting changes show at once, marked "Waiting to upload": a new recipe in the list, and an edit on its recipe page, with when it was saved. Options › Offline copy counts them
- [ ] Offline, the ingredient picker suggests names from the offline copy. A name that isn't there becomes a new ingredient, created when the change uploads; if that gets a 409, the existing ingredient is used
- [ ] The editor checks what the API would refuse before saving (a missing name, lengths, amounts, number ranges), so a change saved offline is rarely refused later. Limits the API and the editor share move into `shared/`
- [ ] Offline, deleting a recipe and renaming or deleting an ingredient say they need a connection
- [ ] Uploading:
  - at the same moments as the snapshot refresh, and on its retry schedule, before the snapshot is fetched
  - oldest first: new ingredients, then a `POST` with the id for a new recipe, or a `PATCH` with `If-Match` for an edit
  - each success replaces the recipe in the offline copy with the API's reply, so the page never steps back to the old version
  - a 409 on a create counts as uploaded: an earlier attempt arrived but its answer was lost
  - if the Pi can't be reached, the round stops and tries again later
- [ ] A 412, 404 or 400 marks the change "Needs your attention" and keeps it on the device, with a banner. Step 18 adds the choices
- [ ] Unit tests for the waiting changes and the uploader: one per recipe, the order, the 409, stopping when the Pi can't be reached, and nothing lost on a reload
- [ ] Playwright:
  - offline, create a recipe with a new ingredient and edit another. Reload while still offline, and find both, marked as waiting. Come back online, and see both reach a second context without a tap
  - let a create reach the API but lose its answer, and check the retry doesn't make a second copy

**Done when:** the tests pass in CI.

## Step 18: When an upload can't go through
**Goal:** a waiting change that meets a change made elsewhere, a deleted recipe or a refusal is settled by you, and never lost or silently saved over another change.

**Why:** with one person and two devices these will be rare, so they're kept apart from Step 17. But they're the one place 3c could lose data.

- [ ] Changed elsewhere (412): both versions shown, with Keep mine (saved over the other, using the newer ETag), Keep theirs (mine discarded) and Keep both (mine saved as a new recipe, with "(copy)" after its name)
- [ ] Deleted elsewhere (404): save it as a new recipe, or discard it
- [ ] Refused (400): the editor opens on the change, with the API's messages beside their fields. Saving it again uploads it
- [ ] Nothing is discarded without a tap, and discarding asks first
- [ ] A 412 while saving online keeps Step 12's dialog: the editor is still open then, so reloading and making the edit again is cheap
- [ ] Component tests for each choice
- [ ] Playwright:
  - edit a recipe offline while a second context changes it, then come back online and choose each of Keep mine, Keep theirs and Keep both
  - edit a recipe offline while the second context deletes it, and save it as a new recipe

**Done when:** the tests pass in CI.

## Step 19: Deploy, and check on the phone (Phase 3c done)
**Goal:** Phase 3c runs on the Pi and meets its success criteria on your phone.

**Why:** Playwright's offline mode stands in for the phone's. Being off the tailnet with Proton on, the app being closed by Android, and persistent storage in Firefox need the real phone.

- [ ] Merge to `main`, then run `scripts/deploy.sh` on the Pi
- [ ] Check that gzip reaches the phone through `tailscale serve` (moved from Step 15): `/api/sync` and the app's script arrive with `Content-Encoding: gzip`
- [ ] On your phone, in the installed app (you):
  - with Tailscale on, open the app so it fetches the snapshot, then tap Protect in Options and allow it
  - switch to Proton or airplane mode: the app opens from the Home Screen, and recipes open, search and work with cooking mode
  - still off the tailnet, create a recipe with a new ingredient and edit another. Close the app fully, reopen it, and check both are there, marked as waiting
  - switch back to Tailscale, bring the app to the front, and check both upload by themselves and appear on the laptop
  - edit the same recipe on the phone, offline, and on the laptop. Reconnect the phone, and settle it with Keep both
  - delete a recipe on the laptop, and check it disappears from the phone at its next refresh
- [ ] Weeks without opening the app: Playwright's clock and the store's unit tests cover it in CI. If you can leave the app unopened for a week or more, check it then and note it in the log
- [ ] Docs: `docs/architecture.md` (the offline copy and waiting changes), `docs/deployment.md` (Protect, and what clearing the site's data loses), and the README if any commands changed
- [ ] Tick the boxes, then update the Status block and the Progress log

**Done when:** every 3c success criterion above is met, and CI is green. **Phase 3c is then complete.** 3b's steps are written next.

## Backlog (later phases)
| When | Items |
|---|---|
| Any time after Step 6 | M6: a JSON export of all data (small, and cheap insurance) |
| Phase 3 | 3a: Steps 9–14 (done). 3c: Steps 15–19, before 3b (D15). 3b gets its steps when it starts, and keeps the offline copy and waiting changes whole as recipes gain sections, steps, tags, equipment and images |
| Later, unscheduled | Ingredient usage, from your wireframe review: see which recipes use an ingredient, then either replace it in all of them at once (a merge) so it can be deleted, or delete those recipes with it. Phone VPNs: Android runs one VPN at a time, so Tailscale and Proton VPN take turns, and Proton doesn't reconnect by itself (Android's Always-on VPN blocks Tailscale outright). Ways to automate or avoid the switch: an automation app (MacroDroid: start Proton when Tailscale disconnects), the Pi as a Tailscale exit node sending its traffic through Proton, or Tailscale's Mullvad add-on |
| Phase 4 | Uptime and disk-space alerts, log rotation, and automated dependency updates (Dependabot or Renovate). V5: the Prisma upgrade, as its own task |
| Phase 5 | F7: the shopping-list tables must exist before Phase 5 can deliver shopping lists. D14: timer alerts while another app is open, through Web Push from the Pi (test it on the phone first, because Firefox for Android has had push bugs) |
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
- **2026-11-02:** Step 5 done, in seven commits (one per sub-section). Tests, type-check and lint passed after each.
  - **Answers:** D6 is a plain array plus `X-Total-Count`. The optional name lookup in 5.3: not now.
  - **Choices:**
    - The recipe PATCH schema is written out, not derived with `.partial()`. In Zod 4 a default still applies inside an optional field, so `.partial()` would reset `servings` to 1 on every PATCH (checked).
    - Query strings are strict, like bodies: a misspelt `?serach=` is a 400, not an unfiltered list.
    - A search term over 100 characters, or a `limit` over 100, gets a 400 rather than being silently cut. `limit=0` is allowed and returns only the total. `offset` is capped at 2^53 − 1, the largest whole number JavaScript holds exactly; Prisma and Postgres both accept it.
    - P2002 → 409 lives in the error handler, with the message "That name already exists."
    - Express's own client errors keep their status: malformed JSON is a 400 and an oversized body a 413. Malformed JSON gets a plain message, because the parser's own one quotes the body back.
    - CORS uses the `cors` package. With `CORS_ORIGINS` unset it runs with `origin: false` and sends no CORS headers. A disallowed origin still gets `Vary` and `Access-Control-Expose-Headers`, which do nothing without `Access-Control-Allow-Origin`.
  - **Tests:** one existing test changed. Its `whole` unit isn't on the D2 list, so that line became a count with no unit. 53 tests passed twice in a row, with 84.6% statement coverage.
  - **Manual curl** against the dev server (`miseenplace_dev`, with `CORS_ORIGINS=http://localhost:5173`). Everything behaved as specified:
    - **Health:** 200 `{ "status": "ok" }`. With the database unreachable, 503 `{ "status": "error" }`, and a list returned a plain 500, with details only in the log. `GET /` is gone (404).
    - **Lists:** ordered by name. `limit`, `offset` and `X-Total-Count` work. `limit=101`, `-1` and `1.5`, `offset=abc`, a repeated parameter and an unknown parameter each got a 400.
    - **Search:** `?search=a&search=b` is a 400. A blank term lists everything, and 101 characters is a 400. `%` and `_` match literally.
    - **Ingredients:** `"  Shallot  "` is stored as `shallot`. A duplicate POST, or a rename to a taken name, is a 409. An unknown field or malformed JSON is a 400. Deleting an in-use ingredient is a 409.
    - **Recipes:**
      - Lines come back in order, with units canonicalised (`Grams` → `g`, `" Tbsp. "` → `tbsp`). A count, a range and a "to taste" line all come back unchanged.
      - A body with many mistakes got one message per field. An unknown ingredient id is a 400.
      - A PATCH with only `ingredients` moved `updatedAt`, a PATCH without them left the lines alone, and `ingredients: []` removed them.
    - **CORS:** the allowed origin gets `Access-Control-Allow-Origin` and can read `X-Total-Count`, and its preflight returns 204. Any other origin gets no `Allow-Origin`.
    - The run deleted everything it created, so dev is back to the seed.
  - **Seen, not acted on:**
    - Unknown routes return Express's HTML "Cannot GET" page, not JSON.
    - When a line has a type error, Zod skips that line's range check until the error is fixed, so a client may see the `quantityMax` message on a second attempt.
    - `npm audit --omit=dev` reports 4 advisories (1 critical, 2 high, 1 moderate), all in Express 5's own dependencies: `body-parser`, `path-to-regexp`, `proxy-addr` and `qs`. `npm audit fix` would update the lockfile. Not done, because no step covers dependency updates yet.
  - CI hasn't run on Steps 4 and 5 yet: the branch isn't pushed.

  Next: Step 6.
- **2026-11-02:** Steps 4 and 5 merged in pull request #2. CI passed on the pull request (run #5, 1m 15s) and on `main` after the merge (run #6, 1m 11s). That was the first run of the Phase 1 migration on a fresh Postgres 17.
- **2026-11-02:** Step 6: every task done locally. It isn't finished until CI passes, which needs the branch pushed and a pull request.
  - **Tests:** 220 in 10 suites (was 53 in 4). They passed twice in a row, in about 27 s each.
    - **Integration, in the existing files:**
      - Ingredients: a rename to a taken name, two simultaneous POSTs of one name (one 201, one 409), and `" Onion "` stored as `onion`.
      - Recipe validation: servings, prepTime, the line rules, unit aliases, unknown fields at both levels, and ids.
      - Line order and values, including one ingredient on two lines.
      - The three PATCH cases for `ingredients`, plus a PATCH that leaves out `servings` not resetting it.
      - Search: a repeated or over-long term, a blank term, and literal `%` and `_`.
    - **New files:**
      - `pagination.test.ts`: both list endpoints, covering paging, totals, the order (including the id tie-break) and invalid parameters.
      - `health.test.ts`: 200, the 503 case, and `GET /` being gone.
    - **Unit tests:**
      - `units.test.ts`.
      - `schemas.test.ts`, which includes name normalisation.
      - `utils.test.ts`: `isPrismaError`, the ILIKE escaping and `fieldMessages`.
      - `assertSafeDatabase` was already covered in Step 3.
    - **Extras beyond the list:** malformed JSON → 400, and `cors.test.ts` for the CORS policy.
  - **Checked that a test can fail:** with the explicit `updatedAt` removed from the recipe PATCH, the `updatedAt` test failed, because the timestamp stayed at its backdated value. So Prisma's `@updatedAt` really doesn't fire when only the lines change.
  - **The 503 case:** the test swaps the client's `$queryRaw` for one that fails, rather than stopping the database.
  - **Coverage:** 93.6% of statements and 90.1% of branches (was 84.6% and 64.8%). Most of what's left is catch blocks for unexpected errors.
    - CI now writes the totals and a per-file table to the run's summary page, using `scripts/coverage-summary.js` and Jest's `json-summary` reporter.
    - There's no threshold yet.

  Next: push `step-6/missing-tests` and open a pull request. Step 6, and with it Phase 1, is done when CI passes.
- **2026-11-02:** Step 6 done, and with it **Phase 1 is complete**. Merged in pull request #3. CI passed on the pull request (run #7, 37 s) and on `main` after the merge (run #8, 46 s).
  - Both CI steps ran: the tests took 4 s, and the coverage summary step ran, which it only does when Jest has written its coverage file. GitHub only shows step summaries to signed-in viewers, so the table itself is still to be checked on the run page.
  - The runs are shorter mainly because `npm ci` hit npm's cache: 5 s, against 41 s in run #5.
  - **Seen, not acted on:** both runs warn that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 and are being run on Node 24. They also note that `ubuntu-latest` is moving to Ubuntu 26 (from 19 Oct 2026). Moving to newer action versions is a dependency update, so it waits for a step that covers one.

  Next: Step 7.
- **2026-11-02:** Step 7: everything drafted. It isn't finished until the spec segments are pasted in.
  - **Spec segments,** in `planning/spec-segments/`. Each starts with exactly what it replaces, then the text to paste:
    - `01-phase1-schema.md`: technical spec §2.1
    - `02-api.md`: §3.1 and the Phase 1 table in §3.2
    - `03-testing.md`: §5
    - `04-dev-and-ci.md`: §6.1 and §6.4
    - `05-phase-plan.md`: the design spec's phases. D5 is reflected; open decisions (D7–D12) are shown as open, with their recommendations.
    - `06-architecture-diagram.md` is an extra: it replaces the design spec's diagram, which is where M1's wrong arrows were.
  - **In the repo:**
    - A new README, covering setup, the test database, environment variables, the safety guard, commands, tests and CI.
    - `.env.example`, which the old README already told people to copy.
    - `docs/api.md`, listing every endpoint with its parameters, bodies, responses and errors, plus the units table.
    - `docs/erd.md` and `docs/architecture.md`, as Mermaid diagrams. The stale `docs/mise-en-place_MVP_ERD.png` is deleted.
  - **Checked against the running code, not from memory:**
    - The 413 message, non-JSON bodies (400 under `(input)`), and non-UUID ids in URLs (404).
    - The search example in `docs/api.md`. The first draft guessed the result wrong; the published example is the real output.
    - All three Mermaid diagrams, rendered with Mermaid 11. Mermaid drew a `https://` address in a label as "Unsupported markdown: link", so that label has no scheme.
  - **Seen, not acted on:** `.env` has a `DATABASE_PORT` variable that nothing reads.

  Next: paste the segments into the specs. Step 7 is then done.
- **2026-11-02:** Step 7 done. The six segments are in the specs.
  - **How:** applied with a script, as asked, instead of pasted by hand. The script replaced exactly the range each segment's header named, and refused to run unless every start and end heading appeared once.
  - **Where:**
    - `technical-spec.md`: §2.1, §3.1, the Phase 1 table in §3.2, §5, §6.1 and §6.4
    - `design-spec.md`: the architecture diagram and the six phases
  - **Checked:** the diff touches nothing outside those ranges, and each join with the old text reads cleanly. The only changes in the end-to-end section (now §5.6) are blank lines: the old ones held a single space.
  - `planning/spec-segments/` is deleted, so the specs are the only copy again.
  - **Seen, not acted on:** two parts of the design spec that Step 7 didn't cover are slightly out of date.
    - "Continuous Integration and Deployment" says CI runs on every push and lists Prettier. CI runs on pull requests into `main` and pushes to `main`/`develop*`, and there's no Prettier config. Its deployment bullets change with Step 8 anyway.
    - The "System Architecture" intro still lists Electron, which D7 may drop.

  Next: Step 8, when you're ready.
- **2026-11-02:** Step 8: the repo side is done and tested on a local copy of the production stack. The Pi itself is next.
  - Step 7's CI passed: run #9 on the pull request and run #10 on the merge into `main`.
  - **8.5 answered: not now.** Tailscale already limits access to your own devices. Revisit before sharing the Pi with anyone.
  - **`docker-compose.prod.yml` (8.3):**
    - It has its own project name, `miseenplace-prod`, so it can never share containers or the volume with the dev stack on one machine.
    - `db` has no ports. `api` is on 127.0.0.1:3000, with `restart: unless-stopped`, and waits for a healthy `db`. Its healthcheck uses Node's `fetch`, because the slim image has no curl.
    - `init: true` puts a small init process in front of Node as PID 1. Node as PID 1 ignores SIGTERM, so every stop would otherwise wait 10 s and then kill it.
    - `${POSTGRES_USER:?}` and the others make Compose refuse to start if `.env` is missing a value, instead of starting with an empty password.
  - **`docker-compose.yml`** lost its `api` service. It published port 3000 on every interface, and plain `docker compose up -d` started it. The dev file is now PostgreSQL only.
  - **`Dockerfile` (8.4):**
    - It runs as `node`, sets `NODE_ENV=production`, and its CMD only starts the server. Migrations moved to `deploy.sh`.
    - `prisma` moved from devDependencies to dependencies, still exactly 6.6.0. The lockfile only lost its dev flags; no version changed.
    - Before this, the runtime image had no Prisma CLI, so its `npx prisma migrate deploy` would have downloaded whatever npm's latest Prisma was. `deploy.sh` now uses `npx --no`, which fails instead (D3).
    - `.dockerignore` now also leaves out `planning/`, `scripts/`, `coverage/`, `.claude/`, local notes and every `.env.*`.
  - **`scripts/deploy.sh` (8.6)** follows the sketch, with three changes:
    - It starts the database first, so the first deploy works too.
    - The pre-deploy backup goes through `backup.sh`.
    - The body is a function. Bash reads a script as it runs, and `git pull` can rewrite this file mid-run; wrapping it in a function makes bash read all of it first.
  - **`scripts/backup.sh` (8.7):**
    - It writes to a `.partial` file and keeps it only if it's non-empty and `pg_restore -f /dev/null` can read all of it.
    - Then it removes dumps older than `KEEP_DAYS` (7), so a failing backup never deletes the good ones.
  - **`scripts/restore-check.sh`** restores the newest dump into `miseenplace_restore_check`, compares the row counts of the three tables and `_prisma_migrations` with the live database, and drops the scratch database.
  - **`.gitattributes`** keeps the scripts' line endings LF on Windows checkouts, and git records them as executable.
  - **`docs/deployment.md`:** the Pi runbook, from the operating system to the done-when checks, plus day-to-day commands and a real restore. The README links to it.
  - **Tested locally,** with Docker Desktop and a throwaway project, `miseenplace-prodcheck`:
    - Deploy run twice: first on an empty database (all 5 migrations), then as an update (rebuild, no pending migrations, API recreated). Data survived.
    - Inside the container: user `node`, `NODE_ENV=production`, PID 1 `docker-init`. Ports: `127.0.0.1:3000` for the API, none for the database.
    - Backup, then restore check: passed (1 recipe, 3 ingredients, 2 lines, 5 migrations).
    - A truncated dump fails both the backup check and the restore check.
    - With the database stopped, the backup fails and leaves no file.
    - Pruning removed a dump dated 8 days ago and kept one from 6 days ago.
    - The real restore in the runbook (`pg_restore --clean --if-exists`) undid a later insert, and search still worked afterwards.
  - Type-check and lint pass. Only `package.json` and the lockfile changed outside Docker and the scripts, so the tests weren't rerun locally; CI runs them, with a fresh `npm ci`, on the pull request.
  - **Left over from the local test:** the stack is stopped, but its volume, `miseenplace-prodcheck_pgdata`, and the `miseenplace-api` image are still on this PC. Deleting the volume needs your OK.
  - **Still to do, on the Pi:** 8.1, 8.2, the first deploy, the cron job, the off-Pi copy, and the done-when checks. Then technical spec §6.2 and §6.3 get the new deploy setup.

  Next: set up the Pi by following `docs/deployment.md`.
- **2026-11-22:** Step 8: what's on the Pi, and the plan for it.
  - Step 8's CI passed: run #11 on the pull request and run #12 on the merge into `main`.
  - **Nothing pulls automatically.** The crontab has two jobs, `~/backup-db.sh` daily at 03:00 and `~/health-check.sh` every 5 minutes, and root has none. The systemd timers are the OS's own. So none of the 2 Nov merges reached the Pi.
  - **The Pi still runs the September setup:**
    - Its checkout is at `ff2d9f7` (3 Mar), with the 16 Sep Docker changes uncommitted on top; those became `8e61e98`. `git pull` would refuse to overwrite them, so the switch-over stashes them first.
    - Compose project `mise-en-place`: Postgres 15 and the API, both `restart: always`, with 3000 and 5432 published on `0.0.0.0` and `[::]`. The data is in the volume `mise-en-place_postgres-data`.
    - One recipe, "Pi Test Recipe" (16 Sep), with no ingredients. The daily plain-SQL backups in `~/backups` are real dumps.
    - 64-bit Pi OS, booting from the SD card (`/dev/mmcblk0p2`). Tailscale isn't installed. You're in the `docker` group, but the remote session started before you were added.
    - `backup-db.sh` doesn't check `pg_dump`'s result. Once the old container is gone, it would write an empty file every night and, from a week later, delete a real backup every day, so its cron line goes at the same time as the old containers.
  - **Answered: start fresh.** The new database doesn't take the test recipe. The old volume and backups stay until the new setup passes the checks.
  - **Answered: the SD card for now.** The SSD is about a month away, so 8.1 stays open until the Pi boots from it.
  - **`docker-compose.prod.yml`:** both services now use Docker's `local` log driver, which rotates and compresses the logs, about 100 MB per container at most. The default keeps every line forever, which wears the SD card and can fill it.
  - **`docs/deployment.md`:** a note on starting from the SD card, and a new section, "Moving to an SSD": back up, copy the dump to your PC, install on the SSD from sections 1–4, restore into the empty database, then deploy. The SD card stays untouched as a fallback.

  Next: the switch-over on the Pi, then the runbook from section 3.
- **2026-11-22:** Step 8: the Pi is switched over, and all four done-when checks pass.
  - PR #6's CI passed: run #13 on the pull request and run #14 on the merge into `main`.
  - **Switch-over:**
    1. Rebooted, so your session picked up the `docker` group.
    2. Removed the two old cron lines.
    3. Took down the old stack without `-v`, so its volume stays.
    4. Stashed the September edits.
    5. Kept the old `.env` as `.env.september`.
  - **Two snags:**
    - The Pi's `origin` was the original repo, `AWhite-Code/mise-en-place`, which stopped at `ff2d9f7` (3 Mar). This repo, `A-W-Coding/mise-en-place`, was created on the evening of 16 Sep, after the Pi had been set up from the old one, so `git pull` said "Already up to date". `git remote set-url` fixed it, and the pull then fast-forwarded to `e725aeb`.
    - `docker compose config -q` only warned about unset variables. The production file stops with an error when a value is missing, so the warnings meant Compose had found no usable `.env` and fallen back to the dev file. Rewriting `.env` in one go, with the password generated inside the file, fixed it. Section 4 of `docs/deployment.md` now writes it that way.
  - **Tailscale:** the Pi is `kitchen-pi`. HTTPS certificates are on and Funnel is off, so `tailscale serve status` shows `https://kitchen-pi.<tailnet>.ts.net (tailnet only)` forwarding to `http://127.0.0.1:3000`.
  - **Checks:**
    1. ✅ The phone, on Tailscale, gets `{"status":"ok"}` from `/api/health`.
    2. ✅ From your PC over the home network, ports 3000 and 5432 are closed. Ping and SSH both reach the Pi, so the test is real. IPv6 couldn't be tested from the PC, because even SSH didn't answer there. Instead, `ss -tln` on the Pi shows the only listener on either port is `127.0.0.1:3000`.
    3. ✅ After `sudo reboot`, both services came back healthy on their own, `ss` showed the same, and the phone check passed again.
    4. ✅ `scripts/backup.sh` then `scripts/restore-check.sh`: passed.
  - **Ticked:** 8.2's name and `serve`, 8.4's build on the Pi, 8.7's restore test, and the four done-when boxes.
  - **Checked on the Pi afterwards:**
    - ✅ A second `deploy.sh` run ended `Deploy OK` (8.6 ticked).
    - ✅ `kitchen-pi` shows **Expiry disabled** (8.2 ticked). The phone keeps its expiry, which is right for a device that can be lost.
    - ❌ `unattended-upgrades` wasn't installed, because section 1 step 4 of the runbook was skipped. You then installed and enabled it (8.1 ticked).
    - ❌ The backup cron line didn't show up: the crontab's last line was blank. You then added it (8.7 ticked). Its first run is at 03:30 on 2026-11-23; check for a `daily-…dump` in the backups folder and `Backed up to …` in `~/miseenplace-backup.log`.
  - **Specs:**
    - Technical spec:
      - §6.2 now describes the real setup: the Compose file, `tailscale serve`, `deploy.sh` and the backups.
      - §6.3 and §2.4 describe Phase 4 as hardening and monitoring, since remote access arrived in Phase 2. The conclusion matches.
      - §6.1 no longer mentions the dev file's old `api` service.
    - Design spec: Phase 2 is marked as running, with its success criteria met and the SSD and off-Pi copy still open.
  - **Still open in Step 8:**
    - the SSD (8.1, about a month away)
    - the encrypted off-Pi copy (8.7, which needs your choice of where)
    - backups of the images directory, which wait for Phase 3
  - **Left on the Pi until the SSD move:**
    - the old volume `mise-en-place_postgres-data`
    - `~/backups` and `~/backups-before-step8`
    - `.env.september` and the stash
    - the three old scripts in your home folder
  - You may want to archive `AWhite-Code/mise-en-place` on GitHub, so nothing pulls from it by mistake again.

  Next: check the first cron backup on 2026-11-23, then choose where the off-Pi copy goes (8.7). After that, the Phase 3 gate.
- **2026-11-22:** Step 8: the off-Pi copy (8.7) is written; the Pi side is next.
  - PR #7's CI passed: run #15 on the pull request and run #16 on the merge into `main`.
  - **Answered: Backblaze B2, with restic.**
    - Why: it's off-site, runs nightly from the Pi without any other machine, and the first 10 GB are free.
    - Considered and not chosen:
      - your PC: in the same house, and only works when it's on
      - Google Drive, using the empty 15 GB on your programming account. restic can keep its repository there through rclone, so the snapshots and encryption would be the same. But it adds rclone on the Pi and a Google sign-in token that Google can revoke without warning, and nothing watches the nightly job yet. It also puts the backups in the same account as that email. Confirmed B2 after comparing the two.
  - **`scripts/offsite.sh`:**
    - **With no arguments:** it backs up the backups folder (skipping `.partial` files) and keeps 7 daily, 4 weekly and 6 monthly snapshots. On Sundays it also downloads a random 10% of the stored data and checks it.
    - **With arguments:** it runs that restic command with the settings loaded, for example `init`, `snapshots` or `restore`.
    - **Settings:** they come from `~/.config/miseenplace/restic.env` on the Pi, never from git. The whole file also goes in your password manager, because without its password nobody can decrypt the copy.
    - **B2's S3-compatible API:** restic's docs recommend it over restic's own B2 backend, because of error-handling problems in the B2 library it uses. The account's master key doesn't work with it, so the Pi gets its own key, limited to the one bucket.
    - **A fixed `--host`:** it keeps one snapshot history across reinstalls, such as the SSD move.
  - **`docs/deployment.md`:**
    - A new section 7: the account, bucket, bucket-only key, settings file, first copy, cron line and a test restore from B2.
    - The cron line runs `offsite.sh` only if `backup.sh` succeeded.
    - "Moving to an SSD" can fetch the dump from B2 instead of going through your PC.
    - The day-to-day table and "Restoring for real" mention B2.
  - Technical spec §6.2 and the README describe the off-site copy.
  - **Tested on this PC with a stand-in for `restic`,** which prints its arguments. That covers the script's logic, not restic itself, so the first real run is on the Pi.
    - Without a settings file, it stops with a message.
    - A settings file written exactly as the runbook says reaches restic intact, including a key containing `/` and `+`.
    - A weekday run does backup then forget, and a Sunday run adds the check.
    - Arguments pass straight through to restic.
    - If backup or forget fails, the script stops with restic's exit code.
    - In the cron line, a failed backup skips the copy.

  Next: set up B2 and the Pi from section 7 of the runbook, including the test restore from B2, then tick 8.7. After that, the Phase 3 gate.
- **2026-11-22:** Step 8: the off-site copy is live, and a restore from it passed (8.7 ticked).
  - PR #8's CI passed: run #17 on the pull request and run #18 on the merge into `main`.
  - **Backblaze:**
    - The first bucket's name had capitals. Backblaze's bucket docs say buckets used through the S3-compatible API must follow S3's naming rules, which allow lowercase only, and a bucket can't be renamed. So it was replaced by a lowercase one before first use, and the runbook now says to use lowercase.
    - The Pi's key is limited to that bucket, with Read and Write.
      - "Allow listing all bucket names" is ticked, because B2's S3-compatible API needs it for a key limited to one bucket.
      - It has no file name prefix and no duration. A duration would make the key expire, and the nightly copy would quietly stop.
      - The runbook now lists these options.
  - **On the Pi:**
    - restic is installed. Its settings are in `~/.config/miseenplace/restic.env`, with a copy in your password manager on your main PC.
    - `init` and the first copy worked. The snapshot shows the host as `miseenplace`, the fixed name from `offsite.sh`.
    - The cron line now runs `backup.sh && offsite.sh` at 03:30, and `crontab -l` shows it once.
    - **Test restore from B2:** `scripts/offsite.sh restore latest` brought the backups folder back. `restore-check.sh` then passed on its newest dump, `pre-deploy-20261122-202542.dump`: 0 recipes, 0 ingredients, 0 lines and 5 migrations, the same as the live database, which started fresh.
  - **Step 8 now:** every box is ticked except the SSD (8.1, about a month away) and the images backups, which wait for Phase 3.
  - **To check on 2026-11-23:** after the 03:30 run, `~/miseenplace-backup.log` should show `Backed up to …` and restic's `snapshot … saved`.

  Next: the SSD when it arrives, following "Moving to an SSD" in `docs/deployment.md`. Meanwhile, the Phase 3 gate (D7–D11) can start, if you want.
- **2026-11-22:** Phase 3 gate: D7–D11 settled, all as recommended.
  - PR #9's CI passed: run #19 on the pull request and run #20 on the merge into `main`.
  - **D7, Electron: dropped.** An installed PWA opens in its own window and works offline, from one codebase and one deploy. Electron would add packaging, signing and updates, and a desktop build could fall behind the API.
  - **D8: a full snapshot with an ETag.** `GET /api/sync` returns everything, with a fingerprint of the response, and a 304 when nothing has changed. It can't miss a child edit or a delete, which timestamp-based delta sync can (F2). A personal collection is a few hundred KB at most.
  - **D9: read-only offline.** Reading and cooking mode work offline, and editing waits for a connection, so two devices can't conflict (F3). It fits the main use, reading on a phone while cooking.
  - **D10: three parts,** each a step of its own:
    - 3a: the UI and cooking mode, on the Phase 1 schema. A usable app at the end of it.
    - 3b: structured instructions and sections, images, tags and equipment, and the missing endpoints (F6, F7).
    - 3c: offline support, following D8 and D9.
  - **D11: the image rules in the Decisions table.** Re-encoding with sharp strips the GPS data phones embed (S4). HEIC is rejected because sharp's standard build can't read it; iPhones normally send JPEG from Safari.
  - The specs still describe these decisions as open; the Phase 3 spec segments will bring them in.

  Next: draft the Phase 3 spec segments.
- **2026-11-22:** Phase 3 gate done: the Phase 3 spec segments are applied.
  - **How:** 14 segments, 9 for the technical spec and 5 for the design spec, were drafted in `planning/spec-segments/` and reviewed. A script then applied them, refusing to run unless every start and end heading appeared exactly once and no two ranges overlapped. A dry run on copies matched the result byte for byte. The drafts are deleted, so the specs are the only copy.
  - **Where:**
    - `technical-spec.md`: §2.1 (four sentences), §2.2–§2.5, the end of §2.6, §3.1, §3.2's Phase 3 and Phase 6 tables, §3.3, a new §3.4 (the web client), §5.6, §6.2, §7.2 and §8
    - `design-spec.md`: System Architecture, Phase 3, Phase 6, Continuous Integration and Deployment, Risk Assessment and the Conclusion
  - **Design-review items taken in:**
    - F1: one origin
    - F2 and D8: snapshot sync
    - F3 and D9: read-only offline, plus `If-Match`
    - F5: fractions, and `shared/`
    - F6: full CRUD, with a recipe edited as a whole
    - F7: `primaryImageId`
    - S4 and D11: the image rules
    - V2 and D7: no Electron
    - V3 and D10: 3a, 3b and 3c
    - M1: recipe links in Phase 6; timers in 3a, 3b and Phase 5
  - **Your review changed four things:**
    - **The offline copy never expires.** TanStack Query's persistence discards data older than 24 hours by default, so the snapshot gets its own IndexedDB record instead, replaced only by a complete newer one.
    - **Firefox on Android is the main target.**
      - Firefox asks before granting persistent storage, and only after a tap, so a Protect button asks for it.
      - Its "Delete browsing data on quit" setting must stay off.
      - Cooking mode copes with a missing wake lock.
      - Playwright runs Firefox as well as Chromium, plus a short hand check on the phone.
    - **Failed refreshes are retried** while the app is on screen (after 15 seconds, doubling up to every 5 minutes), and a Refresh button tries at once. The browser's "online" signal alone can't tell whether the Pi is reachable.
    - **Two open devices stay in step without background syncing.** Each refreshes when the app opens, comes back to the front or reconnects, and after its own saves. A test covers it with two browser contexts.
  - **My proposals you agreed to, beyond the gate decisions:**
    - `If-Match` on recipe edits
    - a recipe edited as a whole
    - the client stack (Vite, React, React Router, TanStack Query, idb-keyval, vite-plugin-pwa, Vitest, Playwright), with `web/` and `shared/` in this repo
    - `stepType` dropped, and `timerSeconds` instead of `timerLength`
    - `instructions` dropped only in a later migration
    - images served at `/media/<id>.webp` with year-long caching
  - **Left for the start of 3a:** styling (plain CSS modules suggested), and confirming on the phone that Firefox for Android supports the wake lock and shows the persistent-storage prompt.

  Next: write Phase 3a's steps into this plan, before any UI code.
- **2026-11-22:** Phase 3a planned: Steps 9–14.
  - Each step ends with its tests passing in CI, so the app works at every stage:
    - **9:** `shared/` (the units list and quantity formatting) and the API's 3a changes (JSON 404s, `ETag` and `If-Match`)
    - **10:** the client's skeleton, served by the API, with Playwright in CI from the start
    - **11:** reading recipes, and keeping open devices in step
    - **12:** editing recipes and ingredients
    - **13:** cooking mode, printing and installing
    - **14:** deploying, then checking the success criteria on your phone
  - Reading comes before editing, so there's a usable app early, and the phone is the main use.
  - Playwright starts in Step 10 rather than at the end, so each feature step adds its own flows.
  - Step 10 must keep the API's `tsc` and ESLint away from `web/`: the root `tsconfig.json` compiles every `.ts` file it finds.
  - **D13 added: styling.** Recommended: plain CSS with CSS Modules. It's needed before Step 10.

  Next: Step 9, once you've looked over the steps.
- **2026-11-22:** Phase 3a: your review of Steps 9–14.
  - **Cooking mode shows the whole recipe.** It's like the print sheet but in larger text, with ingredients then method on a phone, and side by side on a wider screen. Hands are messy while cooking, and you need to see the steps ahead, so it's about keeping the screen on and timers rather than tapping through steps. Optional aids: tap a step or ingredient to dim it, and a text-size control.
  - The one-step-at-a-time view becomes optional, in Phase 5. Technical spec §3.4 and §5.6, the design spec's Phase 3a and Phase 5, and Step 13 are updated to match.
  - **D13 partly answered: plain CSS**, with no Tailwind or component library. Whether to use CSS Modules or plain stylesheets is decided after UI mockups made together, before Step 10.

  Next: Step 9. The mockups can happen any time before Step 10.
- **2026-11-22:** Phase 3a: cooking mode and timers, settled with you.
  - **Cooking mode is a switch on the recipe page that keeps the screen on.** At heart that's all it is. The page doesn't change: the recipe stays readable and scrollable, and wiping a hand to scroll once is fine. This replaces the separate full-recipe screen and its optional aids from the entry above.
  - **Timers: several at once, in 3a,** moved from Phase 5. They're for mid-length waits such as "stir every 15 minutes", not short steps or the oven, which has its own. Most recipes won't need one, so they stay small: a button to add one with an optional label, and small chips at the edge of the screen that never cover the recipe.
  - In 3b, a step with a timer gets a small button beside it.
  - Updated to match: technical spec §3.4 and §5.6, the design spec's Phase 3a, 3b, 5 and 6 (the M1 note), and Steps 13 and 14.
  - **D14 added: timer alerts when the app isn't on screen.** A timer must ring at zero whatever app is open, and a web page can't do that alone on Android. Recommended: Web Push from the Pi. It's needed before Step 13.

  Next: Step 9. The mockups can happen any time before Step 10.
- **2026-11-22:** Step 9 done: shared code and API changes for the client.
  - **`shared/`:** `src/units.ts` moved to `shared/units.ts` with `git mv`, so its history follows it. The build still produces `dist/src/server.js`, with `dist/shared/` beside it, and the Dockerfile's build stage now copies `shared/`.
  - **`shared/quantity.ts`:** `formatQuantity()` and `parseQuantity()` (F5).
    - The fractions are eighths plus thirds, matched within 0.02, so 0.33 shows as ⅓ but 0.3 stays a decimal rather than becoming a wrong fraction. Metric units show decimals.
    - Parsing never guesses: "1,5", "2 eggs" and "1/0" each return an error message.
  - **JSON 404s:** unknown paths under `/api` return 404 `{ "error": "Not found." }`. Paths outside `/api` keep Express's HTML page until Step 10 serves the client there.
  - **Recipe ETags (F3):**
    - The ETag is the quoted `updatedAt` in milliseconds, sent by GET, POST and PATCH.
    - PATCH and DELETE check `If-Match` in the same statement as the write (`where: { id, updatedAt: { in: … } }`), so the check can't be raced. A miss is 412 if the recipe exists, and 404 if it doesn't.
    - Weak ETags never match; `*`, or no header at all, means no check.
    - CORS now exposes `ETag` as well as `X-Total-Count`.
  - **Tests:** 312 in 14 files, all passing locally (up from 220 in 10). `quantity`, `etag`, `not-found` and `recipe-concurrency` are new, and the CORS test now expects `ETag`. Type-check, lint and the build pass. CI runs once the branch is pushed.
  - **Docs:** `docs/api.md` (the 404, a new "ETags and `If-Match`" section, 412 in the error table, `shared/units.ts`), `docs/erd.md`, the README's structure and test count, and technical spec §2.1.

  Next: the UI mockups and the rest of D13, then Step 10. D14 is needed before Step 13.
- **2026-11-22:** D14 answered: timers ring only while the app is on screen, for now.
  - Cooking mode keeps the app on screen anyway, so on-screen timers cover the usual case. A short note by the timers says they can't ring while another app is open.
  - Alerts while another app is open move to Phase 5, which already lists push notifications. The Phase 5 backlog row, technical spec §2.5 and §3.4, and the design spec's Phase 5 now say so.

  Next: the UI mockups and the rest of D13, then Step 10.
- **2026-11-23:** Phase 3a: the UI wireframes, and your review of them.
  - **The wireframes:** a canvas of 14 artboards: phone and desktop for the recipe list, recipe page, editor and Options; Ingredients; cooking mode with timers; the ⋮ menu; adding a timer; other states; and the print sheet. They use Inter and a green accent, with light and dark themes and no yellow.
  - **Your answers on the flow:**
    - Separate pages on both, with desktop just wider: the list becomes tiles, and the recipe page puts ingredients beside the method.
    - Delete sits in each recipe's ⋮ menu and at the bottom of the editor, always behind a confirmation.
    - Ingredients move under a new Options page, in its Advanced section, because they're shared data rather than everyday work.
    - Light and dark themes, with no yellow in the main UI. Tags can be any colour.
  - **Changes from your review:**
    - **No "load more":** the list loads more as you scroll. To keep that fast, list responses drop the ingredient lines (a Step 11 task).
    - **Tags on the list:** a recipe's first two tags show as coloured pills beside its name, on phone and desktop, and the recipe page shows them all. Which two is set by the order of the recipe's tags (`RecipeTag.orderIndex`, from the `tagIds` array), so Banana Bread can lead with Dessert and still be tagged Vegetarian. Tags arrive in 3b, so 3a's rows just leave room.
    - **Editor:**
      - Every ingredient line is shown (the wireframe's "6 more lines" was only an abbreviation), and the Ingredients and Method sections collapse.
      - Each line is one row: Amount, Ingredient and a ⋮ menu. The amount and unit are typed together in one box ("100 g", "1½ tbsp"), which removes the unit picker and answers how to decide when a unit is needed: you type it when the recipe has one. A new `parseAmount()` does the reading.
      - The phone wireframe's boxes ran off the screen, because a fieldset grows to fit its widest content. That's fixed in the wireframe and noted for the real form.
    - **Print sheet:** no "Printed from" footer.
  - **For later:** seeing which recipes use an ingredient, and replacing it everywhere or deleting those recipes, is in the backlog.
  - **Updated to match:** technical spec §2.3 (RecipeTag order), §3.2 (lighter lists, `tagIds` order), §3.4 (pages, Options, the Amount box, tag pills) and §5.6; the design spec's Phase 3a and 3b; and Steps 11–13.
  - **D13 is still open:** CSS Modules or plain stylesheets, to settle before Step 10.

  Next: settle D13, then Step 10.
- **2026-11-23:** D13 answered: CSS Modules.
  - Each component gets its own `*.module.css`, whose class names Vite scopes to that component, so one screen's styles can't change another's. It's still plain CSS, and built into Vite.
  - The theme lives in one global stylesheet as CSS custom properties, the same light and dark tokens the wireframes use, so the Options theme switch and cooking mode just swap values.
  - Technical spec §3.4's stack table now lists it, and Step 10's styling task names the setup.

  Next: Step 10, the client's skeleton.
- **2026-11-23:** Step 10 done: the client's skeleton, served by the API.
  - **`web/`:** its own npm project.
    - Libraries: Vite 8, React 19, React Router 7, TanStack Query 5, Inter (self-hosted through Fontsource), Vitest 5 with Testing Library, ESLint with the React hooks rules, and Playwright.
    - React Router stays on 7 because 8 needs Node 22.22, and this PC has 22.13.
    - The API's `tsc` and ESLint skip `web/`; the client's own type-check covers `shared/`.
  - **The shell:**
    - A header with the app's name and an Options icon.
    - Placeholder pages for the 3a routes, each naming the step that fills it in.
    - The theme as CSS custom properties: the wireframes' light and dark tokens, following the system unless `data-theme` says otherwise, plus `data-text-size`.
  - **The API module** (`web/src/api/client.ts`):
    - JSON in and out; `ETag`, `If-Match` and `X-Total-Count`.
    - An `ApiError` carrying the API's `error`, `fields` and status. A dropped connection, or a 502 or 504 from the proxy, reads "Can't reach the server."
  - **Serving it** (`src/middleware/web-client.ts`, after the `/api` 404):
    - Hashed files under `/assets` are cached for a year, marked `immutable`.
    - Other files, and `index.html`, are sent `no-cache`.
    - A GET or HEAD that wants HTML, outside `/api` and `/media`, with no file extension, gets `index.html`. A missing `.js` file stays a 404, so a stale page can't load HTML as script.
    - `WEB_DIST_DIR` overrides where the built files are (the default is `web/dist`).
  - **Dockerfile:** a `web` stage builds the client, and the final image copies in only `web/dist`, without the client's `node_modules`. The image served `/`, a deep link, a hashed asset and `/api/health` correctly against the dev database.
  - **Playwright:**
    - Four projects: Firefox and Chromium, each at 390×844 and 1280×900. Firefox's phone size is the viewport alone, because Playwright can't emulate a mobile device in Firefox.
    - It runs the built API on port 3100, applies the migrations, and reseeds before each test.
    - The config loads `.env.test` over the environment and refuses any database not ending in `_test`.
  - **Tests:**
    - API: 326 in 15 files, all passing, up from 312 (`web-client` is new).
    - Client: 22 Vitest tests.
    - End-to-end: 4 tests in each of the 4 projects.
    - Lint, type-checks and both builds pass.
  - **Not checked here:**
    - Playwright's Windows build of Firefox won't start on this PC: Windows reports a side-by-side error for its `mozglue` library. Reinstalling it didn't help.
    - Chromium passes at both sizes. The Firefox projects run in CI on Linux, which also checks the new `web` and `e2e` jobs when the PR opens.
    - Locally, run `npm run e2e -- --project=chromium-*` for now. The root scripts now pass extra arguments through to the client's.
  - **CI:** two new jobs beside `test`:
    - `web`: lint, type-check and unit tests.
    - `e2e`: builds both, installs the two browsers, runs Playwright on its own Postgres service, and uploads the report if it fails.
  - **Docs:** the README's structure and test count, and the 404 row in `docs/api.md`. The README's development section and `docs/architecture.md` wait for Step 14, as planned.

  Next: Step 11, reading recipes.
- **2026-11-23:** Step 10's PR (#12) merged; CI run #25 passed all three jobs, including Playwright in Firefox. Nothing needed doing on the Pi: it gets the client at the next deploy (Step 14).
- **2026-11-23:** Step 11 done: reading recipes, and keeping devices in step.
  - **Lighter lists:**
    - `GET /api/recipes` now returns summaries: id, name, description, servings, times and timestamps, without the lines or `instructions` (a Prisma `select`).
    - The recipe page fetches the whole recipe. The API tests and `docs/api.md` say so.
  - **`formatAmount()`** in `shared/quantity.ts`: the quantity and unit together, as a recipe writes them ("1 clove", "1–2 tsp", "½").
    - Word units become plural over 1 ("2 cloves", "1½ cups"); symbols such as g and tsp never do.
    - Tested in Jest beside `formatQuantity()`.
  - **Recipe list:**
    - The API's fuzzy search. The box updates at once, and the search runs 250 ms after you stop typing.
    - The search is kept in the address as `?q=`, so the recipe page's "Recipes" link returns to the same results.
    - Pages of 20, the next fetched when the end of the list is within about a screen (an IntersectionObserver).
    - Empty and no-match states, and a count.
    - Rows on a phone, tiles from 768 px. Each row has room beside the name for 3b's pills.
  - **Recipe page:**
    - Name, description, servings and times; then ingredients and method, side by side on a desktop.
    - Phase 1's instructions are split into steps, one per line, with any leading "1." dropped, since the page numbers them.
    - Edit sits beside the ⋮ on a desktop; on a phone it's in the menu.
    - The cooking mode switch moved to Step 13, which gives it its wake lock.
  - **The ⋮ menu:**
    - Follows the WAI-ARIA menu button pattern: arrow keys, Home, End, Escape, and a tap outside closes it.
    - Edit opens the editor (still a placeholder until Step 12).
    - Print opens the recipe with `?print`, which prints once the recipe has loaded. The print stylesheet comes in Step 13.
    - Delete is shown but disabled, marked "Coming in Step 12".
  - **Options:**
    - Theme and text size, saved in the browser's storage on this device and applied to `<html>` before the first render, so there's no flash of the wrong theme.
    - The connection: "Server reachable", "Can't reach the server" (check Tailscale), or the server up with its database down (a 503 from `/api/health`), with the time of the last check and a Check again button.
    - Advanced › Ingredients: a list and search, loading more as you scroll.
  - **Keeping devices in step:**
    - TanStack Query refetches when a page opens, when the app comes back to the front, and when the connection returns. The header's Refresh refetches everything on screen, and its icon spins while anything loads.
    - 4xx responses aren't retried. A 404 on the recipe page, on first load or at a later refresh, shows "This recipe was deleted".
    - A failed refresh keeps what's on screen under a "Can't reach the server" banner, with Retry.
  - **Accessibility:**
    - Sizes are in rem, so text follows the browser's font size and the Options text size.
    - Tap targets are 44 px. Searches and icon buttons have labels; focus is visible.
    - Back links are named "Back to Recipes" for screen readers, so they aren't confused with the header's links.
  - **Tests:**
    - API: 345 in 15 files. The `GET /` test now checks only that `/` isn't a health answer, since `/` is the client's whenever `web/dist` is built.
    - Client: 63 Vitest tests in 9 files. They render the real routes against a fake `fetch`, with a stand-in IntersectionObserver.
    - End-to-end: 9 tests in each project:
      - search and read a recipe
      - scroll until page 2 loads
      - two contexts, where a recipe added in one appears in the other on coming back to the front and on Refresh
      - a recipe deleted in one context
      - the theme surviving a reload
    - All pass in Chromium here. Firefox runs in CI.
  - **Small fixes:**
    - The client's Node-side TypeScript config needed the DOM types for code Playwright runs inside the page.
    - A simulated `visibilitychange` must bubble to `window`, where TanStack Query listens.

  Next: Step 12, editing recipes and ingredients.
- **2026-11-23:** Step 11's PR (#13) merged; CI run #27 passed all three jobs, including Playwright in Firefox.
- **2026-11-23:** Step 12 done: editing recipes and ingredients.
  - **`parseAmount()`** in `shared/quantity.ts` reads the one Amount box: "100 g", "1½ tbsp", "2-3 cloves", "1 can", or "3" for a count.
    - The unit is the word (or words, "fl oz") at the end, and any spelling `canonicaliseUnit()` knows is accepted.
    - It never guesses. "3 eggs" says “eggs” isn't a unit, and a unit with no number asks for one.
    - It reads back everything `formatAmount()` writes, and Jest checks that round trip.
    - The old private `parseAmount` inside the module was renamed `parseNumber`.
  - **The editor** (`/recipes/new` and `/recipes/:id/edit`):
    - Name, description, servings and times, the ingredient lines, and the method. A new recipe starts with one empty line.
    - On a phone, Cancel, the title and Save stay at the top while you scroll. On a desktop they sit in the heading row.
    - The state lives in `web/src/editor/draft.ts` as plain functions (build the body, map errors, reducer), tested without rendering.
  - **Ingredient lines:**
    - One row each: Amount, Ingredient and a ⋮ menu with Move up, Move down, Add note (or Remove note) and Remove line. A note shows only when the line has one.
    - An amount is checked as you leave its box.
    - A line whose Amount box still shows its saved text sends its saved numbers, so an untouched 0.33 isn't rounded to the ⅓ it's shown as.
    - Empty lines are left out rather than refused.
  - **The ingredient picker:**
    - A combobox that searches as you type, with the arrow keys, Enter and Escape.
    - When nothing has that exact name, "Create ingredient “x”" creates it on the spot. A 409, from one created elsewhere a moment ago, picks the existing one.
    - Leaving the box with an exact name typed picks it; anything else asks you to choose.
  - **Errors:**
    - Problems found here and the API's `fields` (`ingredients.2.unit` and the like) appear next to their boxes, with `aria-invalid` and a summary at the top.
    - Focus moves to the first problem, opening a collapsed section if needed.
  - **Saving** sends `If-Match` with the ETag of the version opened, so a background refresh never moves it.
    - A 412 opens "This recipe changed on another device", and Reload recipe restarts the form from the latest version.
    - A 404 says the recipe was deleted elsewhere.
  - **Leaving with unsaved changes** asks first: React Router's `useBlocker` within the app, and `beforeunload` for the tab.
  - **Deleting a recipe:** from the list's ⋮, the recipe page's ⋮, or the bottom of the editor, always through a confirmation (the browser's `<dialog>`).
    - The recipe page and the editor send the ETag. From the list there's none to send, and the named confirmation is the check.
    - A 412 says the recipe changed and refreshes it; a 404 counts as done.
  - **Ingredients**, under Options › Advanced: each row's ⋮ offers Rename and Delete.
    - Rename edits in place, and a taken name says so (409).
    - Delete asks first. A 409 shows "Can't delete “onion”: a recipe still uses it." at the top.
    - A rename also refreshes recipes, since they show the name.
  - **Tests:**
    - API: 385 in 15 files, including 40 new `parseAmount()` cases.
    - Client: 93 Vitest tests in 11 files. They cover the draft functions, the editor (create, pick, create an ingredient, keyboard picking, errors, the API's `fields`, If-Match, 412 and Reload, the line menu, collapsing, the leave warning, delete), deletes from the list and the recipe page, and renaming and deleting ingredients.
    - jsdom has no `<dialog>` methods, so the test setup adds stand-ins.
    - End-to-end: 4 new tests in each project:
      - create with a new ingredient, edit, and delete
      - the 412 prompt from a second context
      - the leave warning
      - rename an ingredient, and a refused delete
    - All 26 per browser pass in Chromium here. Firefox runs in CI.
  - **From the visual check:** the picker's suggestions now span the whole line, not just the narrow Ingredient box, so "Create ingredient “chipotle”" fits on one line on a phone.

  Next: Step 13, cooking mode, printing and installing.
- **2026-11-23:** Step 12's PR (#14) merged; CI run #29 passed all three jobs, including Playwright in Firefox, and run #30 on `main` too.
- **2026-11-23:** Step 13 done: cooking mode, printing and installing.
  - **Cooking mode** is a switch in a panel on the recipe page (`web/src/cooking/`), beside the Timer button. Nothing else on the page changes.
    - `useWakeLock()` asks for the Screen Wake Lock, asks again whenever the page becomes visible (the browser drops it when hidden), and releases it when the switch is turned off or you leave the recipe.
    - The switch belongs to one recipe: opening another starts with it off.
    - Where there's no wake lock, or the browser refuses one (the Claude Browser pane does), the panel says the screen may sleep, on a line of its own.
  - **Timers** (`web/src/timers/`):
    - Started from the "New timer" sheet: an optional label, and a length from 5, 10, 15, 20, 30 and 45 minutes or set to the minute (1–600).
    - Running timers are chips along the bottom of every page, with a cancel button and a + to add another. The page leaves room for them.
    - Each is kept as the moment it ends, in the browser's storage, so it's right after the screen locks and survives a reload. One that ended meanwhile rings on return.
    - An ending timer plays a three-note chime made with Web Audio (so nothing to download), vibrates on Android, and grows into "Stir: time's up" with Dismiss.
    - It rings again every 5 seconds until dismissed, for up to 2 minutes.
    - Starting a timer is the tap that unlocks audio.
    - Options › Cooking has a Timer sound switch, a Test button, and the note that timers ring only while the app is on screen (D14).
  - **Printing:** print styles hide the header, the back link, the menus, the cooking panel and the timers, and print black on white even from the dark theme, with 16 mm × 14 mm page margins. Chromium's output was checked as a PDF from the production image.
  - **Installing:**
    - vite-plugin-pwa 2.0.0 (added as this step says; it supports Vite 8) generates the manifest and a Workbox service worker.
    - Manifest: name, short name, `display: standalone`, start URL `/`, theme colour `#1f7a5c`.
    - It precaches the app's 22 files (about 680 KB, fonts and icons included), so the app opens with no connection. Any page address falls back to `index.html` offline, but `/api` and `/media` never do.
    - `autoUpdate` with `skipWaiting` and `clientsClaim`: a new deploy takes over when the app starts, and the page reloads into it once. Timers survive that, being stored.
    - Icons: a bowl with three ingredients, drawn as SVG in `web/icons/` and rendered to PNG by `web/scripts/make-icons.mjs` with Playwright's Chromium. That gives 192 and 512 px, a maskable 512 with the mark inside the safe zone, a 180 px Apple touch icon, and the SVG favicon.
    - The API already serves `manifest.webmanifest` as `application/manifest+json`, and `sw.js` with `no-cache`.
  - **The production image installs:** run on this PC, Chromium's own check (`Page.getInstallabilityErrors`) found no errors, the manifest had none, and the service worker controlled the page.
  - **Tests:**
    - Client: 112 Vitest tests in 13 files:
      - timers with faked clock and intervals: two at once, ringing, repeats and their 2-minute limit, sound off, cancel, surviving a reload, and the sheet's lengths
      - cooking mode with a stand-in wake lock: on, off, taken again when visible, released on leaving, unsupported, refused
      - the timer sound option
    - End-to-end: 19 in each project, 6 of them new:
      - cooking mode with a counted stand-in wake lock
      - two timers with Playwright's clock
      - print styles
      - the manifest and its icons
      - the service worker registering and the app opening offline at a deep link
      - Chromium finding the app installable (skipped in Firefox)
    - All pass in Chromium here; Firefox runs in CI. API: 385, unchanged.
  - **Small fixes on the way:**
    - The generated worker skipped waiting but didn't claim open pages until `clientsClaim` was set.
    - Playwright's role names match substrings, so "5 min" and "Timer" needed `exact: true`.
  - **Audit:** adding vite-plugin-pwa brings 4 moderate advisories in `glob` and `minimatch`, inside `workbox-build`. That code only runs at build time over our own files, and isn't in the app. Not fixed, like the API's.

  Next: Step 14, deploy to the Pi and check on the phone. Phase 3a is then complete.
- **2026-11-23:** Step 13's PR #15 merged, with CI green, Firefox end-to-end included. Then Step 14 done, and with it **Phase 3a**.
  - **Deploy:** `scripts/deploy.sh` on the Pi built the new image, web client included, found no migrations to apply, and passed its health check. A `curl: (56) Recv failure` along the way was the first health check reaching the port while the server was still starting. The retry 2 seconds later passed.
  - **This PC on the tailnet:** it joined the tailnet, and reached the Pi from PowerShell, but Firefox timed out. Proton VPN's split tunnelling is in Inverse mode, sending Firefox, Chrome and a few other apps through Proton, which can't reach the tailnet. Edge isn't included, so the desktop app is installed from Edge. Edge offered it only through the address bar's "App available" button, with its Apps menu greyed out. Its service worker was activated and running.
  - **The phone:** Android runs one VPN at a time, so Tailscale and Proton VPN take turns, and Proton doesn't come back by itself. Always-on VPN for Proton stops Tailscale from starting at all. The checks ran with Tailscale on. That finding opened D15 (offline edits, revisiting D9), and the switching itself went into the backlog.
  - **The checks, all passed:**
    - The app installed from Firefox for Android and opens from the Home Screen.
    - Recipes were created, found, read, edited and deleted on the phone.
    - Cooking mode kept the screen on through a whole recipe, and the timers stayed out of the way.
    - Two devices: a recipe added on the phone appeared on the PC as soon as its window came to the front. That's the plan's direction reversed, through the same refresh on focus.
    - Printing from Edge gave just the recipe: its name, details, ingredients and method. The date, title and address round the edge are Edge's own headers and footers, which its print dialog turns off under More settings. A page can only hide them by dropping its page margins, which would leave later pages of a long recipe running to the paper's edge, so they stay. Firefox's print preview wasn't checked by hand, since this PC's Firefox can't reach the Pi. Playwright checks the print styles in Firefox in CI.
  - **Docs:**
    - The README: setting up and running the client, the root scripts, the client's tests, the three CI jobs, and the API serving the client.
    - `docs/architecture.md`: a development diagram with Vite, and the Pi serving the client to the installed app and its service worker. Electron is gone (D7).
    - `docs/deployment.md`: the Dockerfile's three stages, and a new section 8 on installing the app on the phone.
  - **Updates after a deploy:** an installed app picks up the new version the next time it opens, reloading into it once. One left open during a deploy keeps the old version until it's reopened or reloaded.

  Next: D15. Then the steps for 3c or 3b, whichever it puts first.
- **2026-11-24:** Step 14's PR #16 merged. D15 settled as recommended: offline drafts, in 3c, with 3c built before 3b.
  - **What D15 means:** a recipe created or edited with the Pi out of reach is kept on the device as a *waiting change*, shown at once, and uploaded by itself when the Pi answers again. An edit uploads with the ETag it started from, so the F3 check catches a change made elsewhere meanwhile, and you choose Keep mine, Keep theirs or Keep both. Deleting recipes, and renaming or deleting ingredients, still need a connection. New recipes get their id on the device, so a retried upload can't create one twice. That's 3c's one API change, and it needs no schema change.
  - **Specs:**
    - The technical spec: §1 (ids made by the client), §2.3 (the 3a, 3c, 3b order), §3.1 (the `id` exception, and `If-Match` for offline edits), §3.2 (`POST` takes an `id`), §3.3 (the snapshot flows one way; tags and equipment join it with 3b), §3.4 (a new "Editing offline" part) and §5.6 (the tests).
    - The design spec: the Phase 3 decisions, with D15 added; 3b keeps the offline copy whole; 3c is renamed Offline Use, with three new success criteria; the risks and the conclusion.
    - Caching images for offline moved from 3c to 3b, which brings the images.
  - **Plan:** Phase 3c's Steps 15–19 are written: the API (15), the offline copy (16), saving offline and uploading (17), uploads that can't go through (18), and the deploy and phone check (19).

  Next: review Phase 3c's steps, then Step 15.
- **2026-11-24:** Phase 3c's plan merged (PR #17, CI green). Step 15 done.
  - **`GET /api/sync`** (`src/routes/sync.ts`) returns `{ recipes, ingredients }`.
    - Each recipe is read with the same `RECIPE_INCLUDE` as `GET /api/recipes/:id`. That moved into `src/utils/recipe-query.ts`, so the two can't drift apart.
    - Both lists are sorted by name, then id, and the lines by `orderIndex`.
    - The two queries run in one transaction at REPEATABLE READ, so they see the database at a single moment. Otherwise a recipe saved between them could use an ingredient missing from the list.
  - **The ETag** is the body's SHA-256, in base64url and quoted. `If-None-Match` uses the weak comparison, as HTTP says it should, so `W/"…"`, a list containing the ETag, and `*` also get the 304. The response has `Cache-Control: no-cache`.
  - **Compression:** `compression` 1.8.2 (released 2026-09-11) and its types are new dependencies. It's the first middleware in `app.ts`, so it covers the client's files too. It skips responses under 1 kB, where it saves little, and types that are already compressed. Whether `tailscale serve` passes it through is checked in Step 19, after the deploy. It's a plain reverse proxy, so it should.
  - **Ids chosen by the client:** `createRecipeSchema` takes an optional `id`, a UUID, lowercased because ids are stored and compared as text. The POST route turns P2002 into 409 "A recipe with that id already exists.". The create and its lines are one statement, so nothing changes. `PATCH` still refuses `id`, which an existing test checks.
  - **Tests:** 420 API tests, 35 of them new.
    - `tests/sync.test.ts`: the shape and order, the ETag across five kinds of change, the 304s, compression, and unit tests of `snapshotEtag()` and `noneMatch()`.
    - `recipe-api.test.ts`: five for the `id`, including a create sent twice leaving one copy.
    - `schemas.test.ts`: its "unknown field" example for a new recipe was `id`; it's now `createdAt`, and the `id` has tests of its own.
    - Playwright in Chromium: all 38 pass, against the rebuilt API, now serving the client's files gzipped.
  - **Docs:** `docs/api.md` (the snapshot, the `id`, compression), and the README (endpoints, structure, test count).

  Next: Step 16, the offline copy.
- **2026-11-24:** Step 15 merged (PR #18, CI green, Firefox e2e included). The branches already merged into `main` were deleted, locally and on GitHub. Step 16 done.
  - **The store** (`web/src/offline/storage.ts`, `copy.ts`):
    - The snapshot in IndexedDB through idb-keyval 6.3.0 (released 2026-07-08, no dependencies of its own), in a database of its own, `mise-en-place`.
    - One record, `{ data, etag, fetchedAt }`, plus `snapshotCheckedAt`, so a 304 writes a timestamp rather than the whole snapshot again. Nothing expires it.
    - Only a snapshot that parsed and has the right shape is stored; a body cut off partway, or a captive portal's page, isn't. The copy in memory changes only once it's stored.
  - **Refreshing** (`offline/sync.ts`):
    - A conditional GET (`apiRequestIfChanged()`) with `If-None-Match` and `cache: 'no-store'`: the device keeps its own copy, so the browser's cache needn't keep another.
    - It follows TanStack Query's own focus and online signals, so its moments are the pages' own, plus every save and the Refresh button.
    - A failed refresh is retried after 15 s, doubling up to every 5 minutes, only while the app is visible; each moment starts the schedule afresh. A moment during a refresh brings another after it, so a save made meanwhile isn't missed.
    - Once a refresh gets through, the pages that came from the copy fetch again from the API.
  - **Reading offline** (`api/queries.ts`, `offline/read.ts`):
    - The recipe list, a recipe and the ingredient list fall back to the copy on a network error (no answer, or Tailscale's 502 or 504), marked `fromCopy`.
    - Search on the device: every word typed appears in the name, ignoring case and accents.
    - With no copy yet, or a recipe the copy hasn't got, the 3a error shows as before.
    - A banner above the page (in `Layout`) shows while anything on screen came from the copy: "Can't reach the server. Showing the copy saved on this device, refreshed 3 days ago.", with Retry.
  - **Options › Offline copy:** how many recipes, when it was refreshed, the last failure, whether storage is protected, Protect (`navigator.storage.persist()` straight from the tap), and Refresh now.
  - **Two things fixed on the way:**
    - TanStack Query's default `networkMode: 'online'` holds requests back while the browser says it's offline. In airplane mode a page would have stayed on "Loading…" instead of reading the copy, and a save would have waited forever instead of saying it can't reach the server. Queries and saves now use `'always'`; a test fails with the old setting.
    - `apiRequest()` let a body cut off mid-download escape as a bare TypeError. It's now a network error, like no answer at all.
  - **The editor doesn't edit the copy.** The API's recipe ETags are opaque (`docs/api.md`), so the copy has none, and a save from it after the connection came back would have gone without `If-Match`, over any change made elsewhere. Offline, the editor says it can't reach the server, as in 3a.
  - **To settle before Step 17:** an offline edit keeps "the ETag it started from", but the snapshot doesn't carry each recipe's ETag. Recommended: `GET /api/sync` adds them (for example `etags: { "<recipe id>": "<etag>" }`), so they stay opaque and the client never works one out from `updatedAt`.
  - **Tests:** the client has 182, 70 of them new.
    - `copy.test.ts`: a copy fetched 60 days ago is still there, a newer one replaces it whole, a 304 moves only `checkedAt`, storage that can't be read.
    - `sync.test.ts`: the 304, five kinds of failed refresh leaving the copy untouched, storage that's full, the retry schedule over 20 minutes, hidden and visible, the connection returning, the pages fetching again, a moment during a refresh, and a page's fallback bringing a retry.
    - `read.test.ts`: device search, paging and `fromCopy`.
    - `OfflinePages.test.tsx`: each page from the copy, the banner, the editor, a save while the browser says it's offline, catching up by itself, Retry and Refresh, and Options' line with Protect.
    - `client.test.ts`: a body cut off partway, and the conditional GET. `format.test.ts`: `formatAge()`.
    - Playwright: `offline.spec.ts`, three tests. Offline in the open app and after a fresh start (search, a recipe, cooking mode, Ingredients); coming back online; a blocked `/api/sync` retried, with `page.clock`. Chromium: all 44 pass. Firefox runs in CI.
    - Playwright found what the unit tests missed: `loadOfflineCopy()` kept answering with what its first read found (nothing) after a refresh had stored a copy, so pages offline showed the error. Fixed, with a unit test.
  - Checked in the Browser pane: Options › Offline copy at phone width, and the banner over the list with the API stopped.
  - **Docs:** the README's structure. `docs/architecture.md` still says recipes come from the API until 3c; Step 19 updates it, as planned.

  Next: Step 17, saving offline, once the snapshot's ETags are settled.
