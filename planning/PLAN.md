> Created on 27 September 2026. This is the live copy: progress is ticked off here as each step is done.

# Mise en place: hardening plan (Phase 1 to Phase 4)

> **Status**
> - Current step: **Step 29: alerts**, built (2026-11-27): `monitor.sh`, `nightly.sh` and the runbook's section 9, checked here against a stand-in for Healthchecks. Next (you): deploy, which brings the scripts and Step 28's updates to the Pi, then the accounts, the two checks, `alerts.env`, cron and log rotation, then each alert on the phone. Step 28 done (2026-11-27): Dependabot's first round settled, PRs #37–#50. **Phase 3 is complete (2026-11-26):** 3a (2026-11-23), 3c (2026-11-24) and 3b (Steps 20–26, PRs #24–#32, CI green), all deployed on the Pi and checked on your phone. Step 8 waits only on the SSD (8.1, about a month away)
> - Last updated: 2026-11-27 (Step 29: alerts, built)
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
| D16 | How alerts reach you (Phase 4) | **Healthchecks.io, with alerts through ntfy.** Every 5 minutes the Pi checks the API (locally and over its `ts.net` address) and its disk, then pings a Healthchecks check, adding `/fail` when something's wrong; each nightly backup and off-site copy pings a second check. A failure, or no ping in time, pushes an alert to the ntfy app. Only a watcher outside the Pi can notice the Pi itself going silent. The traffic is outbound only: one small HTTPS request every 5 minutes to one fixed host, carrying only "ok" or "fail" and the disk use; nothing connects in. The ping addresses and the ntfy topic are secrets kept on the Pi, never in the repo. Alternatives: email instead of ntfy (no new app or service on the phone, but easier to miss); ntfy alone (it can't notice the Pi going down); hosting Healthchecks yourself, which needs a second always-on machine | Step 29 | **Decided 2026-11-26: Healthchecks.io + ntfy.** You asked that the setup talk to the wider internet as little as possible, with every opening managed: so outbound only, plain check names, and nothing but the status and the disk use in a ping |
| D17 | How dependency updates arrive | **Dependabot, weekly.** Built into GitHub, with one config file. Minor and patch updates come grouped, one pull request each for the API, the client, GitHub Actions and the Docker images; each new major version on its own. Nothing merges itself. Alternative: Renovate, a GitHub app with more control (a dashboard issue, finer grouping, automerge rules), but another app with access to the repo and a bigger config | Step 28 | **Decided 2026-11-26: Dependabot, weekly** |
| D18 | The Prisma upgrade (V5; revisits D3) | **6.19.3, then 7.10.1, each a step of its own.** Catching up within 6 needs no code changes; Prisma 7 then changes only what its upgrade guide says (the generator and its output path, `prisma.config.ts`, a Postgres driver adapter). npm's `latest` tag points at `8.0.0-rc.36`, a release candidate. Alternatives: straight to 7.10.1 (one step, but a failure is harder to place); 6.19.3 now and 8 once it's stable | Steps 30–31 | **Decided 2026-11-26: 6.19.3, then 7.10.1**, pinned exactly each time |
| D19 | Phase 4's extras | **Node 22 → a newer LTS**, since Node 22's support ends on 30 April 2027. Optional: M6 (a JSON export of all data) and S1 (the API refusing requests not from your Tailscale login, answered "not now" in Step 8.5) | Step 32 | **Decided 2026-11-26: Node only, to Node 26** (the newest LTS, supported until April 2029, and supported by Prisma 7.10.1 and sharp). M6 and S1 stay in the backlog |

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
- [x] Back up the images directory as well, once Phase 3 adds images (Step 24). `scripts/backup.sh` writes a `.media.tar` beside each dump, and `offsite.sh` copies both; `restore-check.sh` checks the pair. Written in Step 24; its first run on the Pi follows Step 26's deploy
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

**Complete** (2026-11-24): every criterion below was met on the phone in Step 19.

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

- [x] `GET /api/sync` gives each recipe's ETag (`etags`, by id), so an edit started from the offline copy keeps the ETag it started from. Added 2026-11-24, as agreed after Step 16: the API's ETags are opaque, so the client can't work one out from `updatedAt`
- [x] Every new recipe gets its id on the device (`crypto.randomUUID()`), online or off, so there's only one way to create a recipe
- [x] Save tries the Pi first. If it can't be reached (no answer, or a 502 or 504 from Tailscale), the change is kept in IndexedDB as a waiting change, and the editor closes as it does after any save
- [x] At most one waiting change per recipe: editing a recipe that has one edits that version, and keeps the ETag it started from. Waiting changes survive a reload and the app being closed
- [x] Waiting changes show at once, marked "Waiting to upload": a new recipe in the list, and an edit on its recipe page, with when it was saved. Options › Offline copy counts them
- [x] Offline, the ingredient picker suggests names from the offline copy. A name that isn't there becomes a new ingredient, created when the change uploads; if that gets a 409, the existing ingredient is used
- [x] The editor checks what the API would refuse before saving (a missing name, lengths, amounts, number ranges), so a change saved offline is rarely refused later. Limits the API and the editor share move into `shared/`
- [x] Offline, deleting a recipe and renaming or deleting an ingredient say they need a connection
- [x] Uploading:
  - at the same moments as the snapshot refresh, and on its retry schedule, before the snapshot is fetched
  - oldest first: new ingredients, then a `POST` with the id for a new recipe, or a `PATCH` with `If-Match` for an edit
  - each success replaces the recipe in the offline copy with the API's reply, so the page never steps back to the old version
  - a 409 on a create counts as uploaded: an earlier attempt arrived but its answer was lost
  - if the Pi can't be reached, the round stops and tries again later
- [x] A 412, 404 or 400 marks the change "Needs your attention" and keeps it on the device, with a banner. Step 18 adds the choices
- [x] Unit tests for the waiting changes and the uploader: one per recipe, the order, the 409, stopping when the Pi can't be reached, and nothing lost on a reload
- [x] Playwright:
  - offline, create a recipe with a new ingredient and edit another. Reload while still offline, and find both, marked as waiting. Come back online, and see both reach a second context without a tap
  - let a create reach the API but lose its answer, and check the retry doesn't make a second copy

**Done when:** the tests pass in CI.

## Step 18: When an upload can't go through
**Goal:** a waiting change that meets a change made elsewhere, a deleted recipe or a refusal is settled by you, and never lost or silently saved over another change.

**Why:** with one person and two devices these will be rare, so they're kept apart from Step 17. But they're the one place 3c could lose data.

- [x] Changed elsewhere (412): both versions shown, with Keep mine (saved over the other, using the newer ETag), Keep theirs (mine discarded) and Keep both (mine saved as a new recipe, with "(copy)" after its name)
- [x] Deleted elsewhere (404): save it as a new recipe, or discard it
- [x] Refused (400): the editor opens on the change, with the API's messages beside their fields. Saving it again uploads it
- [x] Nothing is discarded without a tap, and discarding asks first
- [x] A 412 while saving online keeps Step 12's dialog: the editor is still open then, so reloading and making the edit again is cheap
- [x] Component tests for each choice
- [x] Playwright:
  - edit a recipe offline while a second context changes it, then come back online and choose each of Keep mine, Keep theirs and Keep both
  - edit a recipe offline while the second context deletes it, and save it as a new recipe

**Done when:** the tests pass in CI.

## Step 19: Deploy, and check on the phone (Phase 3c done)
**Goal:** Phase 3c runs on the Pi and meets its success criteria on your phone.

**Why:** Playwright's offline mode stands in for the phone's. Being off the tailnet with Proton on, the app being closed by Android, and persistent storage in Firefox need the real phone.

- [x] Merge to `main`, then run `scripts/deploy.sh` on the Pi
- [x] Check that gzip reaches the phone through `tailscale serve` (moved from Step 15): `/api/sync` and the app's script arrive with `Content-Encoding: gzip`
- [x] On your phone, in the installed app (you):
  - with Tailscale on, open the app so it fetches the snapshot, then tap Protect in Options and allow it
  - switch to Proton or airplane mode: the app opens from the Home Screen, and recipes open, search and work with cooking mode
  - still off the tailnet, create a recipe with a new ingredient and edit another. Close the app fully, reopen it, and check both are there, marked as waiting
  - switch back to Tailscale, bring the app to the front, and check both upload by themselves and appear on the laptop
  - edit the same recipe on the phone, offline, and on the laptop. Reconnect the phone, and settle it with Keep both
  - delete a recipe on the laptop, and check it disappears from the phone at its next refresh
- [x] Weeks without opening the app: Playwright's clock and the store's unit tests cover it in CI. If you can leave the app unopened for a week or more, check it then and note it in the log
- [x] Docs: `docs/architecture.md` (the offline copy and waiting changes), `docs/deployment.md` (Protect, and what clearing the site's data loses), and the README if any commands changed
- [x] Found by the phone check: a start with Proton on showed nothing until the request to the Pi failed, which takes seconds. Pages now show the copy at once while the Pi is asked (added 2026-11-24)
- [x] Merge that, redeploy, and recheck on the phone that a start with Proton on shows the recipes at once (you)
- [x] Tick the boxes, then update the Status block and the Progress log

**Done when:** every 3c success criterion above is met, and CI is green. **Phase 3c is then complete.** 3b's steps are written next.

## Phase 3b: structured recipes, images, tags and equipment
Phase 3b comes last of the three (D15). Recipes gain sections and steps, with a timer on any step and ingredient lines grouped by section; tags, with colours, shown as pills and used to filter the list; equipment; and images, under D11's rules. Every part of a recipe can be created, changed and removed (F6), and the offline copy and waiting changes keep up with all of it. The specs are the reference: technical spec §2.3 (Phase 3b entities), §3.2 (Phase 3b), §3.4, §5.6, §6.2 (3b) and §7.2, and the design spec's Phase 3b.

Each step builds its feature end to end, API and client together. A step that changed only the API would break the app, which reads the old method text, and as in 3a and 3c the app must work at the end of every step, with its tests passing in CI.

Answered before these steps were written (2026-11-24): wireframes for 3b's screens before any 3b UI code; a new tag or equipment item typed offline is created when the change uploads, like an ingredient; a tag's colour can be any colour, with a row of presets as well; and the order is sections, then tags and equipment, then images.

**Phase 3b is done when** the design spec's 3b success criteria are met:
- A recipe with sections, steps, timers, images, tags and equipment can be created and edited from the phone
- A phone photo uploads with its GPS data removed
- A step with a timer starts it with one tap

And since 3c came first, its criteria still hold with all of this: offline, recipes read from the copy with their sections, tags, equipment and thumbnails, and sections, steps, tags and equipment edited offline upload by themselves.

## Step 20: The 3b schema, and sections and steps through the API
**Goal:** every 3b table exists, every method has become steps, and recipes are read and saved with sections and steps, while the app looks as it does now.

**Why:** the migration touches every recipe, so it comes first and on its own (§7.2), before any new screen depends on it.

- [x] One migration creates every 3b table and column (§2.3): RecipeSection, Instruction, Image, Tag, RecipeTag, Equipment and RecipeEquipment, `Recipe.primaryImageId` and `RecipeIngredient.sectionId`. Every foreign key is indexed, and tag and equipment names get trigram indexes. `Recipe.instructions` stays for now
- [x] The data step is a migration of its own, straight after: every recipe with instructions gets one section, "Method", with a step for each non-empty line, in order, without a leading "1." or "2)" (as the recipe page shows them today). A test runs that SQL on recipes made with instructions, and checks the sections and steps it makes
- [x] The recipe body takes `sections` (each `{ name, steps: [{ text, timerSeconds }] }`) and `ingredients[].sectionIndex`, with §3.2's rules:
  - section names 1–100 characters, step text 1–2,000, timers whole seconds from 1 to 86,400 or null
  - `sectionIndex` must point inside `sections`, and a body with `sections` must also have `ingredients`
  - the limits go in `shared/limits.ts`, for the editor too
- [x] Responses, and so the snapshot, include `sections` with their `steps`, and each line's `sectionId`. `instructions` is no longer read or written
- [x] The client switches over with no new screens yet:
  - the recipe page shows the method from the sections, and so does printing
  - the editor's method box (one step per line) saves as one section, keeping that section's name; a recipe with several sections can't be made in the app until Step 22. (As built: a recipe the API made with several sections gets a box for each, so editing it loses nothing)
  - waiting changes saved before this, with `instructions`, are converted on load into a "Method" section, so they still upload
- [x] Tests:
  - API: the section and step rules, the `sectionIndex` rules, a PATCH replacing sections and lines together, and the data step
  - client: the conversions, in both directions, and an old waiting change converted and uploaded
  - Playwright: the existing tests keep passing
- [x] `docs/api.md` and `docs/erd.md`: sections and steps

**Done when:** the tests pass in CI.

## Step 21: Wireframes for 3b's screens (no code)
**Goal:** the new screens are agreed before they're built.

**Why:** you asked for them, as for 3a. The editor gains the most, and sections, step timers and ingredient grouping all have to fit a phone, used with one hand.

- [x] A canvas of the new screens:
  - the method editor: sections, steps, and a timer on a step
  - ingredient lines grouped by section
  - the recipe page, and cooking mode, with sections and a step's timer button
  - the tag picker, with its colour: a row of presets, or any colour
  - pills on the list and on the recipe page, and the list's tag filter
  - equipment lines
  - the image gallery, the main image, and adding one from the camera
  - Options › Advanced › Tags and Equipment
- [x] Reviewed together. The Progress log records what they settle, and the steps below are adjusted to match

**Done when:** you've reviewed them and the log records the outcome.

## Step 22: Sections and steps in the editor and on the page
**Goal:** a recipe's method has sections and steps with timers, and its ingredients are grouped by section, made and read on the phone.

**Why:** Step 20 changed the data; this gives it its screens, as the wireframes settle.

- [x] The editor's method becomes sections, as the wireframes have it:
  - a card per section, with its name and a ⋮ menu (Move section up, Move section down, Remove section…, asking first when it has steps), and "Add section" below them. (As built: it also asks when lines are in the section, and says they stay, in no section)
  - each step its own box, numbered, with a ⋮ menu (move up, move down, remove) and "Add step to <section>" below the steps. (As built: Enter in a step starts the next one, and pasting several lines makes a step of each, numbering dropped)
  - an optional timer on a step: its Timer button opens a sheet, where the length is typed as "15 min" or "1 h 30 min" and read by `parseDuration()` in `shared/quantity.ts`, beside `parseAmount()`, or chosen from presets (5, 10, 15, 20 and 30 min, 1 h); the sheet also removes a timer. A step with one shows it on the button ("20 min")
- [x] Ingredient lines can be put in a section, sent as `sectionIndex`: a line's ⋮ menu gains a Section choice (No section, or one of the recipe's sections). The editor groups the lines under their section's name, lines in no section first. (As built: the choice appears once the method has a section of its own, as the page's headings do; a line moves within its group, and a new line joins the last group, just above Add ingredient)
- [x] The recipe page groups the ingredients the same way, lines in no section first with no heading, and shows the method by section. A step with a timer has a "Start 20 min timer" button that starts it with one tap, through the existing timers; while it runs the button shows the time left, and its chip in the timer bar is named after the step ("Chilli, step 4"). Printing keeps the sections
- [x] The editor checks the new limits before saving, so a change saved offline is rarely refused later. The copy and waiting changes already carry sections (Step 20)
- [x] Tests:
  - unit: `parseDuration()` (in the Jest suite, like `parseAmount()`), and the draft's sections and grouping
  - component: the editor's sections and timers, and the page
  - Playwright: a recipe with two sections, a step with a timer and grouped lines; then the step's timer started from the page

**Done when:** the tests pass in CI.

## Step 23: Tags and equipment
**Goal:** recipes have tags, shown as coloured pills and used to filter the list, and equipment lines. Both are shared lists, managed like ingredients.

**Why:** two shared lists with the same shape, so they're built together (F6).

- [x] API (§3.2):
  - `/api/tags` and `/api/equipment`, with full CRUD. Names are normalised like ingredients' and unique (409); a tag's colour is `#rrggbb` or null
  - deleting a tag removes it from every recipe; deleting equipment a recipe uses is a 409
  - the recipe body takes `tagIds` and `equipment` (`{ equipmentId, quantity, optional }`); responses include both, and the list's lighter rows include the tags
  - `GET /api/tags` gives each tag's `recipeCount`, for the filter's order and the question before a delete (from the wireframe review)
  - `GET /api/recipes?tag=<id>` filters, with search and paging
  - the snapshot gains `tags` and `equipment`
- [x] The editor, as the wireframes have it:
  - Tags just under the name: the recipe's pills, each with a × to take it off, then "Add tag", which opens a picker that searches and creates on the spot ("Create tag “weeknight”"). (As built: the "Add a tag" box is always there, rather than behind a button: one tap fewer, and one state fewer)
  - a new tag's colour: ten presets, or any colour (the browser's colour picker, with a box for the `#rrggbb` code), with a preview pill
  - Equipment as its own collapsible section after Ingredients: each line has the item (the same kind of picker), a − / + count, an Optional box, and a ⋮ menu (Move up, Move down, Remove line)
- [x] Pills: a recipe's first two tags beside its name on the list, and all of them on its page, in the tag's colour, with dark or light text chosen for contrast. Names are stored in lower case; pills show them with a capital first letter. A pill on the recipe page opens the list filtered by that tag
- [x] The list's tag filter, one tag at a time: a row of tag chips under the search box, the most used first, scrolling sideways on a phone and wrapping on a desktop. The tag is kept in the address (`?tag=`), so Back and a refresh keep it, and a line says how many recipes it found, with Clear. It works together with search. Offline, it filters on the device. (As built: the address holds the tag's id, `?tag=<id>`, which the API filters by and which survives a rename)
- [x] Options › Advanced gains Tags and Equipment, like Ingredients:
  - Tags: each tag's pill and how many recipes use it; a ⋮ menu with Rename, Change colour (the same picker as a new tag) and Delete…, which asks first ("It comes off 3 recipes")
  - Equipment: rename, and delete, refused while a recipe uses it
- [x] Offline, as you answered: the pickers suggest from the copy, and a new tag or item is picked by name and created when the change uploads, using the existing one on a 409. Renaming or deleting one needs a connection
- [x] Tests:
  - API: the CRUD, the 409s, `recipeCount`, the body, and the filter
  - client: the pills' contrast on light and dark colours, the pickers, the filter, and a new tag created offline uploading with its recipe
  - Playwright: tag a recipe and filter the list by it; add equipment; rename and recolour a tag in Options
- [x] `docs/api.md` and `docs/erd.md`. (As built: the ERD already had both tables from Step 20; the README's endpoint table too)

**Done when:** the tests pass in CI.

## Step 24: Images in the API, and on the Pi
**Goal:** images upload under D11's rules, are served, and are backed up.

**Why:** this is where untrusted files reach the Pi, so it's built and tested on its own, before any screen uses it.

- [x] New dependencies, named here as the working rules ask: `sharp` (re-encoding, prebuilt for 64-bit ARM Linux, so nothing extra on the Pi) and `multer` (multipart uploads, held in memory). (As built: sharp 0.35.5 and multer 2.5.0, with `@types/multer` for development. The lockfile holds sharp's builds for both 64-bit ARM and x64 Linux, and the audit's four advisories are the same Express ones as before)
- [x] `POST /api/recipes/:id/images` and `DELETE /api/images/:id` (§3.2, D11):
  - the type is recognised from the contents: JPEG, PNG or WebP, anything else a 415
  - at most 15 MB (413), and 50 megapixels, read from the header before decoding (400)
  - turned upright, then re-encoded to WebP at 2,000 px on the long side, plus a 400 px thumbnail, with all metadata stripped; the upload itself is discarded
  - the files are named after the new row's id; at most 10 per recipe (409)
  - the files are written before the row, and removed if the transaction fails; deleting an image, or its recipe, deletes its files
  - from the wireframe review: a recipe's first image becomes its main one, and deleting the main image makes the next one (in upload order) the main one, in the same transaction
- [x] `primaryImageId` in the recipe body; recipe responses include `images` and `primaryImageId`, and the list's rows `primaryImageId`
- [x] `/media/<id>.webp` and `/media/<id>-thumb.webp`, cached as `immutable`, from a folder set by `MEDIA_DIR`
- [x] The Pi:
  - a named volume for the images, mounted into `api` and owned by its `node` user
  - `backup.sh` saves the images beside each dump, and `offsite.sh` sends both to B2, which closes Step 8.7's last box
  - "Moving to an SSD" in `docs/deployment.md` moves the images too
- [x] Tests, with images made by sharp inside the test:
  - a JPEG carrying a GPS position comes back without it
  - SVG, GIF and HEIC refused; a file over 15 MB; a small file that would expand past 50 megapixels; an 11th image
  - the files gone with their image, and with their recipe
  - the first image becoming the main one, and the next taking over when the main one is deleted
  - `primaryImageId` refused for another recipe's image
- [x] `docs/api.md`, `docs/erd.md`, `docs/architecture.md` and `docs/deployment.md`. (As built: the ERD already had the Image table from Step 20)

**Done when:** the tests pass in CI.

## Step 25: Images in the app
**Goal:** images can be added from the phone's camera or its photos, a main image chosen, and thumbnails seen in the list, offline too.

**Why:** the last of 3b's features, now the API is ready (Step 24).

- [x] Images live on the recipe page, not in the editor, as the wireframes settled: the main image heads the page, labelled with how many there are ("3 photos"), and opens the recipe's Photos page:
  - "Add photo" (the phone offers its camera or its photos), with the rules beside it: JPEG, PNG or WebP, up to 15 MB, location removed
  - a grid in upload order, the main one marked, an upload in progress shown in its place, and "3 of 10". (As built: the upload shows a moving bar, not a percentage: `fetch` can't report how much has been sent, and the one API client stays on it)
  - each photo's ⋮ menu: Make main photo, View full size, and Delete photo…, asking first
  - a refused file named in the message ("party.gif wasn't added. Only JPEG, PNG and WebP images are accepted."), and the 10-image limit explained
  - offline, Add photo is disabled and says it needs a connection; a recipe that hasn't uploaded yet says "Add photos once it's uploaded"
- [x] The list shows each recipe's main image as a thumbnail (a plain plate when it has none), and on a desktop the tiles show it larger
- [x] Offline (§3.4): the service worker caches every thumbnail ahead of time, after each snapshot refresh, and full images as they're viewed, the most recent 100. A deleted image's files drop out as they expire. (As built: rather than waiting for them to expire, the same pass after each refresh drops the cached files of photos the snapshot no longer has)
- [x] Tests:
  - component: the gallery, choosing the main image, and adding one offline saying it needs a connection
  - Playwright: upload an image and make it the main one, see its thumbnail in the list, then go offline and still see it

**Done when:** the tests pass in CI.

## Step 26: Deploy, check on the phone, and drop `instructions` (Phase 3b done)
**Goal:** Phase 3b runs on the Pi and meets its success criteria on your phone.

**Why:** the migration meets your real recipes here, and the camera, its GPS data and the image backups need the real phone and Pi.

- [x] Merge to `main`, then run `scripts/deploy.sh`: it backs up, then migrates (§7.2)
- [x] Check a few migrated recipes in the app: each method is a "Method" section with the same steps (you). The backup taken before migrating is the way back. (Also compared from the PC: the Pi's snapshot before and after)
- [x] Then a last migration drops `Recipe.instructions` (§7.2), and a second deploy
- [x] On your phone (you):
  - create a recipe with two sections, a step with a timer, grouped ingredient lines, two tags, equipment, and a photo taken there and then
  - start the step's timer with one tap; edit the recipe
  - offline: read it, thumbnail included, and edit its sections and tags, then reconnect and see the change upload by itself
  - (As found: a typed tag offered no "Create tag", since its suggestions opened below the bottom of the screen. Fixed in PR #32, redeployed and checked again. The recipe left on the Pi has no ingredient lines, so grouping them by section is shown by `sections.spec.ts` in CI, not on the phone)
- [x] The stored photo has no GPS position (checked from the PC, on the file the Pi serves)
- [x] The nightly backup includes the images, and so does the off-site copy
- [x] Docs: anything the deploy changed
- [x] Tick the boxes, then update the Status block and the Progress log

**Done when:** every 3b success criterion above is met, and CI is green. **Phase 3b, and with it Phase 3, is then complete.**

## Phase 4: hardening and monitoring
Phase 4 keeps the running system healthy without you watching it: security fixes reach the Pi, dependency updates arrive as pull requests that CI tests, an alert reaches your phone when something breaks, and Prisma and Node move to current versions. There are no schema changes (technical spec §2.4). The specs are the reference: the design spec's Phase 4 and technical spec §6.3.

Answered before these steps were written (2026-11-26): D16–D19. Log rotation, one of the design spec's deliverables, is mostly done already: Docker's logs rotate since Step 8 (the `local` driver), and Step 29 adds the cron logs. The optional S1 check stays answered "not now" (Step 8.5), and M6 stays in the backlog.

Each step that changes what runs on the Pi deploys it at its end, so only one change at a time meets the Pi, with `deploy.sh`'s backup as the way back.

**Phase 4 is done when** the design spec's success criteria are met:
- An alert fires when the API is down or the disk is nearly full
- Dependency updates arrive as pull requests that CI tests

And: no known advisory in the API's production dependencies, and the Pi runs Prisma 7.10.1 and Node 26, with the backups and the restore check passing.

## Step 27: Security fixes, and fresh images on every deploy
**Goal:** the API's four advisories are fixed, and every deploy brings the Node and Postgres images' own security fixes.

**Why:** `npm audit --omit=dev` reports four advisories in packages Express uses, one of them critical (`proxy-addr`). And `deploy.sh` builds on whichever Node image the Pi first downloaded and never downloads `postgres:17` again, so the fixes in those images never arrive.

- [x] `npm audit fix` in the API: `body-parser`, `path-to-regexp`, `proxy-addr` and `qs`, each within its current major version, so only the lockfile changes. `npm audit --omit=dev` then reports nothing. (As built: `body-parser` 2.4.0, `path-to-regexp` 8.4.2, `proxy-addr` 2.0.8, `qs` 6.17.1. The fix also moved ESLint and typescript-eslint up a minor version. A dev-only advisory under Jest, `brace-expansion` 1.1.12, went to 1.1.22 within its range with `npm update brace-expansion`, so `npm audit` reports nothing at all. sharp's packages for other platforms are all still in the lockfile)
- [x] The client's two moderate advisories (`glob` and `minimatch`, inside ESLint and Workbox's build tools) never reach the browser, and fixing them needs breaking updates: they're left to Dependabot (Step 28)
- [x] `deploy.sh` downloads before it builds: `compose pull db`, then `compose build --pull api`, so each deploy starts from the newest `node:22-slim` and `postgres:17`. The `17` tag only moves through 17.x releases, which keep the same data format. `up -d` then recreates the database container only when its image changed: a restart of a few seconds, after the deploy's backup
- [x] The runbook says so, and that a new Postgres major version (18) is a task of its own, since it needs a dump and restore. (The README's deploy line too)
- [x] Tests: Jest, the client's Vitest, lint and type-check, and the end-to-end tests in Chromium here; CI runs Firefox. (575 Jest, 311 Vitest, 70 end-to-end in Chromium, all passing. Both new Compose commands checked with `--dry-run` against the production file)
- [x] Deploy (you): the health check passes, and `docker compose exec db postgres --version` shows the newest 17.x. ("Deploy OK", and the Pi answers its health check from the PC; the version number wasn't recorded here)

**Done when:** CI is green, `npm audit --omit=dev` reports nothing, and the Pi runs it.

## Step 28: Dependency updates as pull requests (D17)
**Goal:** every week, Dependabot opens pull requests for the API, the client, GitHub Actions and the Docker images, and CI tests each one.

**Why:** dependencies fall behind silently: 17 of the API's packages are behind today. This is the design spec's second success criterion.

- [x] `.github/dependabot.yml`, every Monday:
  - `npm` for `/` and for `/web`; `github-actions` for the workflow's actions (`checkout`, `setup-node` and `upload-artifact`, all on v4); `docker` for the Dockerfile's `node` image; `docker-compose` for the Compose files' `postgres` image
  - minor and patch updates grouped, one pull request per ecosystem and folder; each new major version on its own
  - ignored: `prisma` and `@prisma/client` until Step 31 has upgraded them (D18); new major versions of the `node` image and of `@types/node`, since Node moves only to an LTS, on purpose (Step 32); new major versions of `postgres`, since one needs a dump and restore
  - nothing merges itself: you review and merge, as now
  - (As built: the Jest packages, `jest`, `@types/jest` and `ts-jest`, form one group whatever the update, since a new Jest major needs all three. The `docker` and `docker-compose` entries were left out: both images use a tag naming only the major version, `22-slim` and `17`, so Dependabot could only offer new majors, which are ignored on purpose; their minor releases reach the Pi through Step 27's downloads instead. At most 10 open pull requests per folder, since the API has six majors waiting)
- [x] Dependabot security updates turned on in the repository's settings (you), so a fix for a new advisory arrives when it's published rather than on the weekly round
- [x] CI runs on Dependabot's pull requests as it is: they're pull requests into `main`, and the workflow needs no secrets. Checked on the first ones: all three jobs ran on each of the 12
- [x] The first round: the grouped minor and patch updates merged once green. Each major version (among them TypeScript 7, Jest 30, `dotenv` 18 and the actions' new majors) is merged if CI is green with nothing to change; one that needs code changes is closed with `@dependabot ignore this major version` and a backlog line saying what it needs
  - (As built: merged as they came, all green: the three actions' v7 (#38–#40), the client's minor and patch group (#42: TanStack Query, typescript-eslint), the API's (#46: seven, Express 5.3.0 among them, and `@types/supertest` 7, a major that came in the group), `cross-env` 10 (#49) and React Router 8 (#44). Closed: TypeScript 7 in both folders (#45, #47), since `ts-jest` and `typescript-eslint` don't accept it yet (Backlog), and `jsdom` 31 (#43), which can't run on this PC's Node (Step 32). Replaced by a branch of ours, since each needed a change: Jest 30 (#41), whose lockfile hid `jest-util` from `ts-jest`, and `dotenv` 18 (#48), whose new `dotenv` command clashed with `dotenv-cli`'s; Dependabot closes both once the branch is merged)
- [x] The local working notes' rule "don't upgrade dependencies unless a step says so" becomes: updates arrive as Dependabot's pull requests, each reviewed on its own
- [x] Docs: the README says how updates arrive

**Done when:** Dependabot's first pull requests have opened, CI has tested them, and each is merged or closed with its reason.

## Step 29: Alerts (D16)
**Goal:** your phone gets an alert when the API is down, the disk is nearly full, a backup fails or the Pi goes silent, and another when it's fixed.

**Why:** the design spec's first success criterion. Today a failure is found only when you next open the app, and a failed backup only when you need it.

- [ ] Accounts and the phone (you):
  - a Healthchecks.io account
  - the ntfy app: from F-Droid, which doesn't use Google's push service, or from the Play Store, which does
  - a topic on `ntfy.sh` with a long random name, which acts as its password
  - Healthchecks' ntfy integration sending to that topic, at high priority when something is down; a test notification reaches the phone
- [ ] Two checks, with plain names that say nothing about the home:
  - `health`: a ping every 5 minutes, an alert after 10 minutes without one
  - `backup`: daily at 03:30 (Healthchecks takes the cron expression and the Pi's time zone), an alert after 2 hours without one
- [x] `scripts/monitor.sh`, run by cron every 5 minutes:
  - asks `http://127.0.0.1:3000/api/health` (the API and its database), then the `ts.net` address's `/api/health`, so `tailscale serve` is checked as well
  - reads how full the filesystems holding Docker's data and the backups are (`df`)
  - a failed check is retried for 30 seconds first, so a deploy's restart doesn't raise an alert
  - pings `health` with "ok, disk 41%", or `health/fail` with what failed ("api: 503", "disk 91%, limit 85%")
  - (As built: the `ts.net` check is named `tailnet`, so `tailnet: 502` alone means `tailscale serve`, not the API. The limit counts when reached (85% alerts). `disk: can't read` if `df` can't read a folder. It prints only failures. And a pause file, `~/.config/miseenplace/monitor.paused`: Healthchecks' docs say any ping resumes a paused check, a /fail one included, so pausing there alone wouldn't silence a restore; while the file exists, `monitor.sh` checks and sends nothing)
- [x] `scripts/nightly.sh` replaces the cron line's `(backup.sh && offsite.sh)`: it runs both, pings `backup`, or `backup/fail` with which part failed, and exits with their status. No log lines go in the ping, only which part failed
  - (As built: it reads `alerts.env` only after both scripts have run, so its settings never reach them, and without the file the backup still runs, Healthchecks isn't told, and it alerts on the silence. It starts each night's log with a dated line)
- [x] Both scripts:
  - read their settings from `~/.config/miseenplace/alerts.env`, readable only by you (`chmod 600`), like `restic.env`: the two ping addresses, the `ts.net` address and the disk limit (85%). None of it goes in the repo
  - send each request over HTTPS with a 10-second limit and 3 tries (`curl -fsS -m 10 --retry 3`); if the internet is down, the ping just fails, and Healthchecks alerts on the silence
  - LF line endings and the executable bit, like the other scripts
- [ ] Cron (you): `monitor.sh` every 5 minutes, and the nightly line running `nightly.sh`, each logging to a file in your home folder. `monitor.sh` logs only failures, so its log stays small
- [ ] Log rotation for those logs: a `logrotate` rule (`/etc/logrotate.d/miseenplace`: weekly, 8 kept, compressed). Docker's own logs already rotate (Step 8)
- [x] Checked here first, against a stand-in ping server that records each request: all well, an API error, a full disk (a low limit), a backup that fails, and no request carrying more than the status and the disk use
  - (As built: `monitor.sh` against the real API on the dev database and its no-database twin: all well ("ok, disk 87%"), `api: 503` and `api: no answer` after the 30 seconds, `tailnet: no answer`, a low limit, an unreadable folder, two failures at once, the API back within the 30 seconds (no alert), the pause file, no settings file, and Healthchecks unreachable or answering 404. This PC couldn't reach the Pi's `ts.net` address at the time, so the `tailnet` check was pointed at the local API and at a dead port; the Pi checks the real one. `nightly.sh` with stand-ins for the two scripts: all well, the backup failing (the copy skipped), the copy failing, no settings file, and Healthchecks unreachable. Each request held only curl's own headers and a body such as "ok, disk 87%", "api: 503; disk 87%, limit 50%" or "offsite failed")
- [ ] On the Pi (you), each alert reaches the phone, then its recovery notice:
  - the API stopped (`docker compose stop api`), then started again
  - a disk limit below the current use for one run, then put back
  - a backup that fails: `nightly.sh` run with `restic.env` renamed for a moment
  - the Pi silent: cron stopped for 15 minutes (`sudo systemctl stop cron`), then started again
- [x] Docs: a new Alerts section in the runbook (setting up, what each alert means and what to do first, and pausing a check in Healthchecks during maintenance), the new cron lines, and `docs/architecture.md`'s Pi diagram showing Healthchecks and ntfy, outbound only

**Done when:** every alert above has reached your phone, and its recovery notice too.

## Step 30: Prisma 6.19.3 (V5, D18)
**Goal:** Prisma catches up within version 6, still pinned exactly.

**Why:** 6.6.0 is 13 minor versions behind. Catching up within 6 first means Step 31's changes are only Prisma 7's own.

- [ ] Read the release notes from 6.7 to 6.19 for anything this project uses, and note it here
- [ ] `prisma` and `@prisma/client` pinned to exactly 6.19.3 (D3's exact pin stays)
- [ ] `prisma generate`, and `prisma migrate status` on the dev and test databases: nothing to apply, and no drift
- [ ] Tests: Jest, the client's Vitest, lint and type-check, and the end-to-end tests
- [ ] Deploy (you): migrations report nothing to apply, and the app reads and saves

**Done when:** CI is green and the Pi runs Prisma 6.19.3.

## Step 31: Prisma 7.10.1 (V5, D18)
**Goal:** Prisma 7, after reading its upgrade guide.

**Why:** Prisma 7 changes how the client is generated, configured and connected (design review V5). It gets a step of its own, so nothing else changes with it.

- [ ] Read Prisma 7's upgrade guide, and list here what applies before changing anything. Expected, from V5:
  - the `prisma-client` generator replaces `prisma-client-js` and needs an `output` path. The client becomes project code, imported from there instead of `@prisma/client`: in `prisma/client.ts`, the routes' `Prisma` error checks, the seed and the tests
  - `prisma.config.ts` replaces `package.json`'s `prisma` block (the seed command) and the datasource's `url`, and loads `.env` itself, keeping the rule that values already set win
  - a driver adapter: `@prisma/adapter-pg`, with `pg`, given `DATABASE_URL`
- [ ] The Dockerfile copies the generated client into the production image in place of `node_modules/.prisma`, with `prisma.config.ts`, so `deploy.sh`'s `npx --no prisma migrate deploy` still works with the image
- [ ] What must not change:
  - `assertSafeDatabase()` still refuses anything but `_test` and `_dev`
  - the tests' `globalSetup` still migrates once per run
  - the raw queries (`fuzzySearchByName()`, the snapshot's REPEATABLE READ transaction) give the same results
  - P2002, P2003 and P2025 still map to the same answers
- [ ] Pinned exactly to 7.10.1, and Step 28's ignore for Prisma removed: later 7.x releases arrive as pull requests. Prisma 8 waits until it's stable, as a task of its own
- [ ] Tests: everything, including the end-to-end tests; the dev database migrated and seeded with the new client
- [ ] Deploy (you): migrations report nothing to apply, the app reads and saves on the phone, and `restore-check.sh` passes
- [ ] Docs: the Prisma commands in the README and the runbook, `docs/architecture.md` if it names the client's path, and the local working notes' code map and gotchas

**Done when:** CI is green and the Pi runs Prisma 7.10.1.

## Step 32: Node 26 (D19), and Phase 4 done
**Goal:** the API, the client's build, CI and the Pi run on Node 26.

**Why:** Node 22's support ends on 30 April 2027. Node 26 is the newest LTS ("Lithium", supported until April 2029), and Prisma 7.10.1 (`^20.19 || ^22.12 || >=24.0`) and sharp (`>=20.9`) both support it.

- [ ] `.nvmrc` → 26 (CI reads it), the Dockerfile's three stages → `node:26-slim`, and `@types/node` → 26 in both projects
- [ ] This PC's Node (22.13.1 today) → 26 (you). React Router 8 asks for Node 22.22 or later (installs here warn, and it works), and `jsdom` 31 needs it
- [ ] `jsdom` 31 in the client, closed in Step 28 (#43) because it needs Node 22.15 or later to load at all: brought back by hand, or with `@dependabot unignore jsdom`. It fails one test, `RecipeEditorPage.test.tsx`'s timer sheet, whose input isn't focused when the sheet opens; probably jsdom 31 has its own `showModal()` now, used in place of `web/src/test/setup.ts`'s stand-in, which doesn't move focus the way browsers do
- [ ] Anything this project uses that Node 24 or 26 changed or removed, from their release notes, noted here
- [ ] sharp's prebuilt files cover Node 26 on 64-bit ARM: the image builds on the Pi, and a photo uploads
- [ ] Tests: everything, including the end-to-end tests
- [ ] Deploy (you): the health check, a photo upload from the phone, `backup.sh` and `restore-check.sh`
- [ ] Phase 4's success criteria, checked together: a test alert reaches the phone, Dependabot's pull requests are arriving every week with CI testing them, and `npm audit --omit=dev` reports nothing
- [ ] Tick the boxes, then update the Status block and the Progress log

**Done when:** CI is green, the Pi runs Node 26, and every Phase 4 criterion is met. **Phase 4 is then complete.**

## Backlog (later phases)
| When | Items |
|---|---|
| Any time after Step 6 | M6: a JSON export of all data (small, and cheap insurance) |
| Phase 3 | 3a: Steps 9–14 (done). 3c: Steps 15–19 (done), before 3b (D15). 3b: Steps 20–26 (done) |
| Later, unscheduled | Ingredient usage, from your wireframe review: see which recipes use an ingredient, then either replace it in all of them at once (a merge) so it can be deleted, or delete those recipes with it. Phone VPNs: Android runs one VPN at a time, so Tailscale and Proton VPN take turns, and Proton doesn't reconnect by itself (Android's Always-on VPN blocks Tailscale outright). Ways to automate or avoid the switch: an automation app (MacroDroid: start Proton when Tailscale disconnects), the Pi as a Tailscale exit node sending its traffic through Proton, or Tailscale's Mullvad add-on. Recipe import beyond URLs (your question, 2026-11-26), building on M5's URL import in Phase 6: first a saved HTML file, read for the same schema.org Recipe data (nothing is fetched, so the home network isn't at risk, and it could run on the device, offline); then PDFs, cookbook photos and pasted text, which carry no such data: text from the PDF, or by OCR from a photo, then an AI model to sort it into ingredient lines and steps, as an option, since it costs a little per recipe, needs a key and the internet, and can be wrong. Every import opens the editor filled in, for you to check and save, and never saves by itself. Which phase it goes in is decided when the next plan is written. TypeScript 7 (its compiler rewritten in Go), closed in Step 28 (#45, #47): `ts-jest` accepts TypeScript below 7 and `typescript-eslint` below 6.1, so it waits until both accept it, then comes back with `@dependabot unignore typescript`. TypeScript 6, which both accept, will probably come first, as a major version of its own |
| Phase 4 | Steps 27–32 (D16–D19): security fixes and fresh images, Dependabot, alerts, Prisma 6.19.3 then 7.10.1 (V5), Node 26. Log rotation: Docker's logs since Step 8, the cron logs in Step 29 |
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
  - **Tests:** the client has 183, 71 of them new.
    - `copy.test.ts`: a copy fetched 60 days ago is still there, a newer one replaces it whole, a 304 moves only `checkedAt`, storage that can't be read.
    - `sync.test.ts`: the 304, five kinds of failed refresh leaving the copy untouched, storage that's full, the retry schedule over 20 minutes, hidden and visible, the connection returning, the pages fetching again, a moment during a refresh, and a page's fallback bringing a retry.
    - `read.test.ts`: device search, paging and `fromCopy`.
    - `OfflinePages.test.tsx`: each page from the copy, the banner, the editor, a save while the browser says it's offline, catching up by itself, Retry and Refresh, and Options' line with Protect.
    - `client.test.ts`: a body cut off partway, and the conditional GET. `format.test.ts`: `formatAge()`.
    - Playwright: `offline.spec.ts`, three tests. Offline in the open app and after a fresh start (search, a recipe, cooking mode, Ingredients); coming back online; a blocked `/api/sync` retried, with `page.clock`. Chromium: all 44 pass. Firefox runs in CI.
    - Playwright found what the unit tests missed: `loadOfflineCopy()` kept answering with what its first read found (nothing) after a refresh had stored a copy, so pages offline showed the error. Fixed, with a unit test.
  - Checked in the Browser pane: Options › Offline copy at phone width, and the banner over the list with the API stopped.
  - **CI on PR #19 (run 39) failed in Firefox:** "coming back online" never showed the banner, in both viewports; the other 84 tests passed.
    - The cause: Firefox, when it's offline, answers from its HTTP cache however old the entry is, instead of failing. The list had loaded from the API before going offline, so its refresh got that old answer and never fell back to the copy. Chromium fails the request, so it passed here. The tests that passed in Firefox only made requests offline that it had never made online.
    - It would have happened on the phone in airplane mode too: an old answer shown as current, with no banner.
    - The fix: every API request uses `cache: 'no-store'`, with a unit test. TanStack Query and the offline copy are the app's caches, and the browser's revalidation of small, gzipped answers saved little.
    - Chromium: all 44 still pass. Firefox won't start on this PC, so CI confirms the fix there.
  - **Docs:** the README's structure. `docs/architecture.md` still says recipes come from the API until 3c; Step 19 updates it, as planned.

  Next: Step 17, saving offline, once the snapshot's ETags are settled.
- **2026-11-24:** Step 16 merged (PR #19, CI green on its second run, after the HTTP cache fix). The snapshot's ETags were agreed: `/api/sync` gives them. Step 17 done.
  - **The snapshot's ETags:** `GET /api/sync` adds `etags: { "<recipe id>": "<ETag>" }` beside the recipes, so each recipe stays exactly as its GET returns it and the ETags stay opaque. An edit from the offline copy sends `If-Match` like one from the API. The API's test checks each against the recipe's own GET, and that an edit made with one goes through.
  - **Shared limits** (`shared/limits.ts`): the API's schemas and the editor read the same lengths and ranges.
    - New maxima: servings up to 1000, prep and cook times up to 99999 minutes (about 69 days). Beyond Postgres's 32-bit integers the API answered 500, which an upload would retry forever, holding up every change behind it. It's now a 400, before anything is written.
    - The editor checks them all before saving, and a new ingredient's name (100 characters).
  - **Saving** (`api/mutations.ts`, `offline/upload.ts`):
    - A new recipe's id is made on the device (`crypto.randomUUID()`), online or off.
    - Save tries the Pi first. With no answer (or Tailscale's 502 or 504), the change is kept as a waiting change, and the editor closes as after any save. A save that gets through drops any older waiting version.
  - **Waiting changes** (`offline/waiting.ts`): one per recipe, in IndexedDB beside the copy, oldest first. Saving one again keeps its place in the queue; the editor opens it with its own kind and ETag. The list in memory changes only once it's stored. A version whose upload got no answer is remembered (`sent`).
  - **Uploading:** each round, before the snapshot is fetched.
    - New ingredients first, by name; a 409 means it exists, and that one is used. Then a POST with the id, or a PATCH with `If-Match`. Each reply goes into the offline copy at once (`putRecipeInCopy()`).
    - A Pi out of reach, or a 5xx, stops the round. A 412, 404 or 400 marks the change, which then waits for you (Step 18).
  - **A lost answer:** when a retry hears 409 (a create) or 412 (an edit), the recipe is read back and compared.
    - It's this version: it arrived, and counts as uploaded.
    - It's a version sent before from this device: that arrived, and the newer one is saved over it, with the ETag just read.
    - Anything else changed it elsewhere: a 412, and it isn't saved over.
    - So a dropped connection never creates a recipe twice, and a retry never overwrites someone else's change. If a change uploads while it's being saved again, the newer version stays waiting, as an edit of the one that uploaded.
  - **What shows:** a "Waiting to upload" list above the recipes, searched on the device; an edited recipe's row with its new name and a tag; a notice on the recipe's page with when it was saved, or why it couldn't upload; a banner on every page while a change needs your attention. Options counts them, and says they'd go with an unprotected copy.
  - **The editor offline:** a recipe opens from the copy, with its ETag. The ingredient picker suggests from the copy, and a name that isn't there is picked as new, to be created when the recipe uploads.
  - **Still online only:** deleting a recipe, and renaming or deleting an ingredient, say they need a connection. Deleting a recipe drops its waiting change; a new one that never left the device counts as deleted (404).
  - **Fixed on the way:** TanStack Query assumes it starts online and only hears of changes. An app opened with no network never noticed the network coming back, so nothing uploaded until the next retry, up to 5 minutes later. `startSync()` now tells it `navigator.onLine`. Playwright found it; a unit test fails without the fix.
  - **Tests:**
    - The API has 426, 6 of them new: the snapshot's ETags, and the limits (400, not 500).
    - The client has 216, 33 of them new, with `test/fakeServer.ts`, an in-memory API that honours `If-Match` and can drop an answer. `waiting.test.ts`; `upload.test.ts` (the order, new ingredients and their 409, a lost answer on a create and on an edit, a create edited after its lost answer, 412, 404 and 400, stopping when the Pi can't be reached or answers 500); `OfflineEditing.test.tsx`; and updates for the new body and limits.
    - Playwright: `offline-editing.spec.ts`, two tests. Offline, a new recipe with a new ingredient and an edit to another, a fresh start, then back online with no tap; and a create whose answer is lost, with no second copy. Chromium: all 48 pass. Firefox runs in CI.
  - Checked in the Browser pane: the recipe's notice and the list's waiting section at phone width, with the API stopped. That throwaway change was deleted from the pane's storage before the API came back, so it never uploaded.
  - **Docs:** `docs/api.md` (the limits, the snapshot's `etags`), and the README.
  - **CI on PR #20 (run 42) failed in Firefox:** in the first Playwright test, nothing reached the server within 5 s of coming back online, in both viewports; the other 92 tests passed, and everything offline worked.
    - Without the logs (they need a sign-in), the cause is one of two: Firefox's emulated reconnect fires no "online" event for a page that started offline, or fires it a moment before requests get through. Either way the upload waited for the next retry, 15 s or more away.
    - The second is what a phone does too: the network comes back a few seconds before Tailscale has reconnected.
    - The fix: the sync hears the browser's "online" event itself, rather than through TanStack Query, and a refresh that fails just after it is tried again after 3 s, before the usual schedule. TanStack Query is still told the state at start, for the pages' own refetch.
    - The test allows 20 s, time for one retry, since what it checks is "with no tap", not "at once".
    - Unit tests for both; Chromium: all 48 still pass. CI confirms Firefox.

  Next: Step 18, when an upload can't go through.
- **2026-11-24:** Step 17 merged (PR #20, CI green on its second run, after the reconnect fix). Step 18 done.
  - **Each choice rewrites the waiting change** (`offline/settle.ts`), then asks for a sync, so it uploads at once if the Pi can be reached, and by itself later if not.
    - Keep mine: the same edit, with the ETag of their version, from the API or the copy. If theirs changes again first, it's another 412, and the choice comes back.
    - Keep both: mine becomes a new recipe with an id of its own and "(copy)" after its name, shortened to fit 200 characters, keeping its place in the queue. Theirs is untouched.
    - Keep theirs: mine is dropped.
    - Deleted elsewhere: save it as a new recipe (the same name, a new id), or discard it.
    - Refused: the editor opens on the change with the API's messages beside their boxes, the first one focused. "One or more ingredient IDs are invalid." becomes "An ingredient on this recipe was deleted elsewhere. Choose it again, then save." Saving uploads it.
  - **Both versions:** a Yours/Theirs switch on the recipe's page shows either. Theirs comes from the API, or from the copy offline.
  - **Asking first:** Keep theirs and Discard each ask, and so does Keep mine, since it replaces the other device's change. Keep both and saving as new lose nothing, so they don't.
  - A 412 while saving online still gets Step 12's dialog, for a waiting change opened in the editor too.
  - **Tests:**
    - The client has 226, 10 of them new, in `Settle.test.tsx`, against the fake API: both versions; Keep mine with their ETag; Keep theirs, with Cancel first; Keep both; Keep mine offline, then uploading; save as new; discard; the refused editor with its messages and focus; an ingredient deleted elsewhere; `copyName()`.
    - Playwright: `settle.spec.ts`, four tests, each a real conflict made offline on the phone while the laptop changes or deletes Beef Chili: Keep mine (after looking at both), Keep theirs, Keep both, and save as new. Chromium: all 56 pass. Firefox runs in CI.
  - Checked in the Browser pane: the panel at phone width, and the Yours/Theirs switch, with a stand-in change put in the pane's storage and removed afterwards. Nothing was written to the dev database.

  Next: Step 19, deploy, and check on the phone (Phase 3c done).
- **2026-11-24:** Step 18 merged (PR #21, CI green). Step 19:
  - **Deployed** (`deploy.sh`, Deploy OK). Before it, `/api/sync` gave 404 on the Pi.
  - **Gzip through `tailscale serve`:** the app's script arrives with `Content-Encoding: gzip`, 434,924 bytes as 133,641. The snapshot was 872 bytes at first, under the 1 kB threshold, so it wasn't compressed; after the phone checks added recipes it was 1,763 bytes, arriving gzipped as 587. `ETag`, `Vary: Accept-Encoding` and the 304 all pass through too.
  - **On the phone** (your checks), every one passed:
    1. Options › Offline copy showed the recipes; Protect was allowed.
    2. On Proton, after closing the app fully: it opened from the Home Screen, and recipes, search and cooking mode worked. But nothing showed until the request to the Pi failed, a wait of a few seconds.
    3. Off the tailnet, a new recipe with a new ingredient and an edit to another were both there after the app was closed and reopened, marked as waiting.
    4. Back on Tailscale, with the app brought to the front, both uploaded "quicker than my eyes could track", and appeared in Edge on the PC.
    5. The same recipe edited on the phone offline and on the PC: after reconnecting, it was settled with Keep both.
    6. A recipe deleted on the PC disappeared from the phone at its next refresh.
  - **The fix for check 2** (`api/queries.ts`): pages showed the copy only once the request to the Pi failed, and with Proton on the Pi's address takes seconds to fail. Now the copy's answer stands in at once while the API is asked (TanStack Query's `placeholderData`), and the API's answer replaces it. Your suggestion, over a 3-second timeout: nothing waits at all, and moving between pages or searching offline doesn't wait either.
    - Standing in isn't "from the copy", so the banner still shows only once a request has failed. Loading more waits for the real first page.
    - The ingredient picker suggests from the copy at once too, and offers Create from it; online, a name that exists after all gets a 409, and the existing ingredient is picked.
    - The editor still waits for the API's version (or its failure), so an older copy isn't edited into a 412.
  - **Tests:** the client has 230, 4 of them new: the list and a recipe from the copy at once with no banner, the API's answer replacing it, the banner once it fails, the editor waiting, and the picker. Playwright: a fresh start with `/api/recipes` held for 15 s shows the list within 3 s, with no banner. Chromium: all 58 pass. Firefox runs in CI.
  - **Docs:** `docs/architecture.md` gains "From Phase 3c: working offline", with a diagram of the refresh round; the development diagram shows compression and the sync route. `docs/deployment.md`: what works offline, saving offline, Protect, what clearing the site's data loses, and settling a change that couldn't upload. The spec's "Refreshing" describes the copy shown at once.
  - Weeks without opening the app: CI covers it (the store's 60-day test). If you leave the app unopened for a week or more, check it then and note it here.

  Next: merge the fix, redeploy, and recheck check 2 on the phone. Phase 3c is then complete, and 3b's steps are written next.
- **2026-11-24:** Step 19 merged (PR #22, CI green, Firefox included). Redeployed. Your recheck: with Proton on, a fresh start now shows the recipes at once, and the banner a few seconds later. **Phase 3c is complete.**

  Next: Phase 3b's steps, written the same way, when you're ready.
- **2026-11-24:** Phase 3b's steps written: Steps 20–26.
  - **Answered first:**
    - wireframes for 3b's screens before any 3b UI code, as for 3a (Step 21)
    - a new tag or equipment item typed offline is created when the change uploads, like an ingredient
    - a tag's colour can be any colour, with a row of presets as well
    - the order: sections, then tags and equipment, then images
  - **Each step builds its feature end to end,** API and client together, so the app works at the end of each. Step 20 does the riskiest part first: every 3b table in one migration, and the old method text moved into steps by a second, testable one. The app switches to sections there, with no new screens yet, and converts any waiting changes saved in the old shape.
  - **Images come last,** in two steps: the API and the Pi first (Step 24), with the D11 rules tested before any screen uses them, and the Pi's image volume and backups, which closes Step 8.7; then the app (Step 25).
  - **Step 26** deploys, checks the migrated recipes on the Pi, and only then drops `Recipe.instructions`, as §7.2 has it.
  - **New dependencies, named in their step:** `sharp` and `multer` (Step 24).
  - **Spec updates:** a tag's colour (any, with presets), and new tags and equipment typed offline (technical spec §3.4).

  Next: review Phase 3b's steps, then Step 20.
- **2026-11-24:** Phase 3b's steps merged (PR #24). Step 20 done.
  - **Two migrations:**
    - `phase3b_tables`: every 3b table and column, generated with `prisma migrate diff` and read before applying. It only adds: seven tables, `Recipe.primaryImageId` (unique, `SET NULL`) and `RecipeIngredient.sectionId` (`SET NULL`), an index on every foreign key, and trigram indexes on tag and equipment names.
    - `instructions_to_steps`: hand-written SQL, one statement. Each recipe's text becomes one section, "Method", with a step per line, trimmed, without a leading "1." or "2)", blank lines skipped, exactly as the page showed them. On the dev database it turned Beef Chili's 14 numbered lines into 14 steps; `migrate dev` then found no drift.
  - **`Recipe.instructions` stays until Step 26,** read by nothing: the shared Prisma client leaves it out of every read (a global `omit`), so no response can carry it by accident. The seed now writes Beef Chili's method as a "Method" section.
  - **The API:**
    - the recipe body takes `sections` and each line's `sectionIndex`, with §3.2's rules; the limits are in `shared/limits.ts`
    - POST and PATCH are now one interactive transaction each: sections get their ids first, so their lines can name them. PATCH's version check is still its first statement, and locks the row, so a racing write still gets a 412 and nothing changes
    - responses, and so the snapshot, include `sections` with their `steps`, each line's `sectionId`, and `primaryImageId` (null until Step 24); `instructions` is refused as an unknown field
  - **The app,** with no new screens:
    - the recipe page shows the method from the sections, with a heading for each only when there's more than one, or the one isn't called "Method"
    - the editor keeps a box per section, a step per line. A step kept as it was keeps its timer, and a line keeps its section, so a recipe the API made with several sections survives an edit
    - waiting changes saved before this are converted on load into a "Method" section, the versions sent with no answer included, and upload as normal
    - an offline copy from before this (with text, not sections) is fetched again whole rather than shown broken
  - **Tests:**
    - The API has 448, 22 of them new. `instructions-migration.test.ts` runs the migration's own SQL on recipes made with text: numbering, blank lines, CRLF, no text, and the text left in place. `sections.test.ts`: create and read, PATCH replacing sections and lines together, a PATCH leaving them, a stale `If-Match` changing nothing, the cascade, a section with no steps grouping lines, and eleven refusals.
    - The client has 242, 12 of them new: drafts with several sections, timers and grouping; the API's errors on a section's box; old waiting changes converted, and one uploaded through the fake API; an old copy refused; the page's headings; and the editor's boxes.
    - Playwright: the existing 58 all pass in Chromium against the migrated test database. Firefox runs in CI.
  - **Docs:** `docs/api.md` (the Section object, the body's rules, `instructions` gone), `docs/erd.md` (a Phase 3b diagram), and the README.

  Next: Step 21, the wireframes for 3b's screens.
- **2026-11-24:** Step 20 merged (PR #25, CI green, Firefox included). Step 21 done: the 3b wireframes, and your review of them.
  - **The wireframes:** a canvas artifact, not in the repo, like 3a's. Ten artboards in 3a's look (Inter, the green accent, light and dark), in three rows:
    - the method: the editor with grouped ingredients and the method in sections, setting a step's timer, the recipe page, and a step's timer running in cooking mode
    - tags and equipment: the tag picker with a new tag's colour, the list with a tag filter, equipment lines, and Options › Advanced › Tags
    - photos: a recipe's photos, and the list on a desktop as tiles
  - **Settled, all as recommended:**
    1. Each step is its own box, numbered, with a timer button beside it, rather than one box of text per section. The timer is set in a sheet: typed ("15 min", "1 h 30 min") or a preset.
    2. A line's ⋮ menu chooses its section. Lines in no section come first, with no heading, in the editor and on the page.
    3. Photos live on the recipe page, which opens a Photos page, not in the editor: adding one needs the recipe saved and a connection, while the editor works offline.
    4. The list filters by one tag at a time, with chips under the search box, kept in the address (`?tag=`).
    5. Tags sit just under the name in the editor; equipment is its own section, after the ingredients, each line with a − / + count and an Optional box.
    6. A tag's colour: ten presets, or any colour, with the pill's text turning dark or light to stay readable. A tag keeps the same colour in light and dark themes.
    7. New: a recipe's first image becomes its main one, and when the main one is deleted the next takes over. The spec didn't say; without it, a recipe with photos would show a plain plate on the list until you chose one. Added to technical spec §3.2 (Image Uploads, rule 8) and to Step 24.
    8. Tag names are stored in lower case, as the plan already had it, so "Beef" and "beef" are one tag; pills show them with a capital first letter. Added to technical spec §3.4 and the design spec.
  - **Smaller details from the boards' notes, which you left as they were:** a running step timer shows its time left on the step's button, and its chip is named after the step ("Chilli, step 4"); tag chips are ordered by how many recipes use them, so `GET /api/tags` gains a `recipeCount` (technical spec §3.2), which also lets deleting a tag say how many recipes it comes off; a pill on the recipe page opens the list filtered by it; a refused photo is named in the message.
  - **Steps adjusted to match:** 22 (the section cards, step boxes, the timer sheet, the line's Section choice, the page's timer button), 23 (where tags and equipment sit, the colour picker, the filter row, `recipeCount`, Options › Tags), 24 (the main-image rule and its test) and 25 (the Photos page, its menu and its messages).

  Next: Step 22, sections and steps in the editor and on the page.
- **2026-11-24:** Step 21 merged (PR #26). Step 22 done: sections and steps in the editor and on the page, as the wireframes have them.
  - **Timer lengths:** `parseDuration()` and `formatDuration()` in `shared/quantity.ts`, beside `parseAmount()`. A number alone is minutes ("15"); otherwise numbers with units, largest first ("90 s", "1.5 h", "1 h 30 min", "1h30m"), and a last number with no unit takes the next smaller one ("1 h 30"). Like `parseAmount()` it never guesses, so "1:30" is an error. 1 second to a day, from `LIMITS.timerSeconds`.
  - **The draft:** each section holds its steps, each with its own key, text and timer, so a step's timer stays with it whatever its text becomes (Step 20 matched timers by text). The lines are kept in the order they're shown, grouped: no section first, then each section's. A line moves only within its group; choosing a section sends it to the end of that group; moving or removing a section regroups the lines. What's saved is therefore always in the order the editor showed. The API's messages find their box down to the step (`sections.1.steps.0.text`).
  - **The editor:**
    - a card per section: its name, a ⋮ menu (move, remove), its steps, and "Add step to <section>"; "Add section" under the cards
    - a box per step, numbered, with a Timer button and a ⋮ menu (move, remove). Enter starts the next step, taking what's after the cursor; pasting several lines makes a step of each, numbering dropped, as the migration did
    - the timer sheet: typed or a preset (5, 10, 15, 20, 30 min, 1 h), and Remove timer. It's drawn at the end of the page rather than inside the editor's form, and its submit stops there: the first version, nested in the form, saved the recipe when you pressed Set timer (a test caught it)
    - removing a section asks first when it has steps or lines ("Its 4 steps go with it. Its 2 ingredient lines stay, in no section.")
    - a line's ⋮ menu gains a Section choice, once the method has a section of its own (more than one, or one not called "Method"), shown as ticked choices under a "Section" heading. The menu component gained grouped `menuitemradio` items for it. The lines then show under their section's name, "No section" first
  - **The recipe page:** ingredients grouped the same way (no section first, with no heading; then a small heading per section); the method by section; and a "Start 20 min timer" button on a step with a timer. While its timer runs the button becomes the time left ("18:42 left"), and the timer's chip is named after the step ("Chilli, step 4", or "Step 3" when the method is just "Method"). A timer now remembers the step that started it (`source`). Printing hides the buttons and keeps the sections.
  - **A label change for the tests' sake:** the section's name box is labelled "Section 1", not "Name of section 1", because Playwright's `getByLabel('Name')` matches part of a label, and every spec uses it for the recipe's name.
  - **Tests:**
    - Jest: 501, 53 of them new, for `parseDuration()` and `formatDuration()`, including reading back everything `formatDuration()` writes.
    - The client: 262, 20 of them new: the draft's steps, grouping and moves, Enter and paste, the API's messages on a step; the editor's section cards, the timer sheet (typed, refused, preset, removed), the Section choice and grouping, removing a section, paste and a step's error; the page's grouped ingredients; and a step's timer started with one tap, counting down on the step and named on its chip.
    - Playwright: `sections.spec.ts` makes a recipe with two sections, a timed step and a line in the second section, checks the page, starts the step's timer and lets five minutes pass on Playwright's clock, then reopens the editor. `editing.spec.ts` types its method step by step. All 60 pass in Chromium; Firefox runs in CI.
  - **Docs:** no API change, so none.

  Next: Step 23, tags and equipment.
- **2026-11-24:** Step 22 merged (PR #27, CI green, Firefox included). Step 23 done: tags and equipment, end to end.
  - **The API:**
    - `/api/tags` and `/api/equipment`, with full CRUD, built like `/api/ingredients`: names trimmed and lowercased, a taken one a 409, fuzzy search, paging. A tag's colour is `#rrggbb` (stored lowercase) or null, and every tag these endpoints return carries its `recipeCount`. Deleting a tag takes it off every recipe; deleting equipment a recipe uses is a 409.
    - The recipe body takes `tagIds` (in order, each once) and `equipment` (`{ equipmentId, quantity 1–99, optional }`), replacing what's there in the same transaction as the rest. A tag or item that doesn't exist is checked before writing, so the 400 can say which list was wrong ("One or more tag IDs are invalid."); the foreign key alone can't tell a tag from an ingredient.
    - Responses carry `tags` (each with its Tag) and `equipment` (each with its item); list rows carry the tags. `GET /api/recipes?tag=<id>` filters, with search and paging: fuzzy search gained an optional filter, still a bound parameter. The snapshot gained `tags` and `equipment`.
    - A limit the spec hadn't set: an equipment line's quantity is at most 99, so it stays well inside Postgres's integers, like servings. Added to technical spec §3.2.
  - **The app:**
    - The ingredient picker became one picker for every shared list (`SharedListPicker`): ingredients, equipment and tags, each searching the API and, offline, the copy. A tag isn't created in the picker: "Create tag" opens the colour panel first.
    - Tags under the name: the recipe's pills with ×, an always-visible "Add a tag" box, and the colour panel (ten presets, or any colour through the phone's picker or a `#rrggbb` code, with a preview pill). Online a new tag is created there and then; offline it's kept by name and colour and created on upload.
    - Equipment as its own section after Ingredients: the item (picked or created), − / + for how many, Optional, and a ⋮ menu.
    - Pills: the first two on each list row, all of them on the recipe page (each a link to the list filtered by it), in the tag's colour. The text is black or white, whichever reads better: a test of colours across the whole range showed that only pure black and white guarantee WCAG AA (4.5:1) on any colour, so the pills don't use the theme's near-black.
    - The list's filter: tag chips under the search box, most used first (counts from the API, or worked out from the copy offline), in the address as `?tag=<id>`, with "2 recipes tagged Weeknight · Clear". The search box now leaves other parameters alone, so searching keeps the tag.
    - Options › Advanced gained Tags (pill, recipe count, Rename, Change colour, Delete… with "It comes off 3 recipes") and Equipment, which shares the Ingredients page's code, with its own words.
    - Offline: the copy keeps tags and equipment (an older copy without them is fetched again whole); a waiting change carries its tags and equipment, new ones by name, created on upload before the recipe, the existing one used on a 409; old waiting changes get none. The recipe page doesn't link a tag made offline until it has an id.
  - **Tests:**
    - Jest: 550, 49 of them new: the tag and equipment endpoints (`tags-api`, `equipment-api`), a recipe's tags and equipment in its body, responses, list rows and the `?tag=` filter (`recipe-tags-equipment`), and the snapshot's new lists.
    - The client: 294, 32 of them new: the pill colours (including AA across the colour range), the draft's tags and equipment, the editor's tag picker (pick, create with a colour, offline, remove) and equipment lines, the list's pills and filter (online and offline), the recipe page's tags and equipment, Options › Tags and Equipment, and a new tag and item uploading with their recipe.
    - Playwright: `tags.spec.ts` tags a recipe with a new coloured tag and filters by it, adds equipment, and renames and recolours a tag in Options. All 66 pass in Chromium; Firefox runs in CI. On the way, the Optional checkbox gained an explicit name: Chromium read its hidden suffix with a stray space ("Optional , equipment line 1").
  - **Docs:** `docs/api.md` (Tag, Equipment, tag and equipment lines, the endpoints, `?tag=`, the body, the snapshot) and the README's endpoint table.

  Next: Step 24, images in the API and on the Pi.
- **2026-11-26:** Step 23 merged (PR #28, CI green, Firefox included). Step 24 done: images in the API, and on the Pi.
  - **New dependencies:** sharp 0.35.5 (re-encoding, with libvips prebuilt for 64-bit ARM Linux) and multer 2.5.0 (the upload, held in memory), plus `@types/multer`. Nothing else in the lockfile moved, and `npm audit` shows the same four Express advisories as before. The production image builds here (x64), sharp loads in it, and `/app/media` in it belongs to `node`; the backup's archive, streamed out of a container, and the restore's unpacking into one, both worked against it.
  - **Uploading** (`POST /api/recipes/:id/images`, field `image`), in `src/utils/images.ts` and `src/routes/images.ts`:
    - the type from the first bytes: JPEG, PNG or WebP, anything else a 415 (an SVG, a GIF, a HEIC, or text called `.jpg`)
    - at most 15 MB (413, from multer); at most 50 megapixels, read from the header before decoding (400), with sharp given the same limit in case a header lies; an unreadable file is a 400
    - turned upright (`autoOrient()`), re-encoded to WebP at most 2,000 px with a 400 px thumbnail, never enlarged; sharp writes no metadata unless asked, so the GPS position goes with everything else
    - the files (named after a new UUID, never the upload's name) are written first, then the row in a transaction that moves the recipe's `updatedAt`, and removed if it fails
    - at most 10 per recipe: checked before reading the upload, and again in the transaction after locking the recipe's row, so two uploads at once can't make 11
    - the first image becomes the main one
  - **Deleting** (`DELETE /api/images/:id`): the row, then its files. If it was the main image, the next one in upload order takes over, or the one before it if it was the last. Deleting a recipe removes its images' files once the rows have gone.
  - **The recipe:** `primaryImageId` in the body, checked to be one of the recipe's own images (a new recipe's can only be null), before the foreign key could answer as if an ingredient were wrong. Responses carry `images` in upload order, list rows `primaryImageId`, and so does the snapshot.
  - **`/media`:** only `<uuid>.webp` and `<uuid>-thumb.webp`, from `MEDIA_DIR` (default `media/`, git-ignored), as `image/webp`, `immutable` for a year, with `nosniff`. Anything else there is a 404. The tests write to a temporary folder of their own (`tests/helpers/media-dir.ts`).
  - **The Pi** (in place for Step 26's deploy):
    - a `media` volume mounted at `/app/media`; the Dockerfile makes that folder, owned by `node`, so a new volume takes that owner. The runbook says how to fix one that doesn't
    - `backup.sh` writes `<label>-<stamp>.media.tar` beside each dump, made by a throwaway container of the API's image, so it works with the API stopped; checked with `tar -tf`, pruned with the dumps. `offsite.sh` already copies the whole folder, so B2 gets both. This closes Step 8.7's last box
    - `restore-check.sh` also checks the archive holds two files for each image in the dump, and copes with a dump from before 3b
    - the runbook: the images volume, restoring images for real, and the SSD move carrying them
  - **Tests:** Jest: 574, 24 of them new (`images.test.ts`), with every image made by sharp in the test: a JPEG on its side carrying a GPS position comes back upright with no EXIF at all; scaling and thumbnails; PNG and WebP; SVG, GIF, HEIC and plain text refused; a broken JPEG; a 150-byte PNG claiming 100 megapixels; over 15 MB; an 11th image; the main image's rules; `primaryImageId` refused for another recipe's image; files gone with their image and with their recipe; `/media` and its 404s. On Windows sharp keeps a file it opened by name locked, so the tests read files into memory first.
  - **Docs:** `docs/api.md` (the Image object, the endpoints, `/media`, `primaryImageId`, 413 and 415), `docs/architecture.md`, `docs/deployment.md` and the README.

  Next: Step 25, images in the app.
- **2026-11-26:** Step 24 merged (PR #29, CI green). Step 25 done: images in the app.
  - **The recipe page:** the main photo across the top (rounded and inside the page on a desktop), with "3 photos", opening the Photos page. A recipe with none has "Add photos" under its times; a new one still waiting on the device says "Add photos once it's uploaded". Printing leaves the photo out.
  - **The Photos page** (`/recipes/:id/photos`):
    - Add photo: a file input for JPEG, PNG and WebP, so a phone offers its camera or its photos (and an iPhone sends JPEG, not HEIC); several at once, uploaded one after another to spare the Pi, each shown as a tile with a moving bar
    - the rules beside it; a file over 15 MB refused before it's sent; more than fit cut off with "Only 1 more photo fits, so b.jpg wasn't added."; a refused file named in its message, as the API words it
    - the grid in upload order, the main one marked; a photo's ⋮ menu has Make main photo (a PATCH of that one field, so no If-Match: it can't overwrite anything else), View full size (over the page, in a `<dialog>`, so the installed app doesn't open a tab) and Delete photo…, asking first and saying when the next photo becomes the main one
    - offline, Add photo, Make main and Delete are off, and the page says it needs a connection; 10 photos says so, and Add photo is off
  - **The list:** each row's thumbnail, or a plain plate; a desktop tile shows it across its top. A photo that can't load (offline, not cached) shows the plate rather than a broken image.
  - **Offline:** the service worker caches `/media` files: thumbnails in one cache, kept, and full photos as they're viewed in another, the latest 100 (Workbox, `CacheFirst`, since a file never changes). After every successful refresh, `cacheThumbnails()` drops the cached files of photos the snapshot no longer has, and fetches the thumbnails not cached yet, four at a time. A copy from before this, without `images`, is fetched again whole.
  - **The API client** sends a `FormData` body as it is, for uploads. A waiting change shows the recipe's photos as they were, since a change doesn't carry photos.
  - **Found in the browser pane:** a photo in the first column opened its ⋮ menu off the left edge of a phone. Those now open rightwards (column 1 of 3 on a phone, of 4 on a desktop).
  - **Tests:**
    - The client: 311, 17 of them new: the Photos page (order and the main mark, uploading two in the field `image`, a refused file named, one over 15 MB never sent, only as many as fit, the limit of 10, making one main with no If-Match, deleting with its question, viewing full size, offline, and a recipe not uploaded yet), the recipe page's main photo and "Add photos", the list's thumbnails and plate, and `cacheThumbnails()` against a stand-in Cache Storage (fetching only what's missing, dropping deleted photos' files, leaving out what doesn't arrive).
    - Playwright: `photos.spec.ts` uploads two photos (`e2e/fixtures/`, made with sharp), makes the second main, checks the recipe page and the list's thumbnail, waits for both thumbnails in the service worker's cache, then goes offline and still sees it, with Add photo off; and a refused file, then deleting the only photo. The end-to-end API writes photos to a temporary folder, emptied before each run. All 70 pass in Chromium; Firefox runs in CI.
  - **Docs:** no API change, so none.

  Next: Step 26, deploy, check on the phone, and drop `instructions` (Phase 3b done).
- **2026-11-26:** Step 25 merged (PR #30, CI green). Step 26 done: **Phase 3b, and with it Phase 3, is complete.**
  - **The first deploy** (3b's two migrations, and the images volume): `deploy.sh` backed up, then migrated. The Pi's snapshot, saved before and after, shows each recipe's text became a "Method" section with a step for each line ("phone test toast": "Put toast in toaster"; "test 2": "Eat the onion."), with the ingredient lines unchanged and tags and equipment added. You checked both recipes in the app.
  - **Dropping the column** (PR #31): a last migration drops `Recipe.instructions`, and `prisma/client.ts` loses its global `omit`. The test of the earlier migration now adds the column back inside a transaction, runs that migration's SQL, then rolls it all back, and a new test checks the column is gone. Then the second deploy.
  - **On the phone:** a recipe with two sections, a step with a 5-minute timer started with one tap, equipment, a tag and photos taken there and then, edited afterwards; offline, read with its thumbnail and edited, then uploaded by itself on reconnecting.
  - **Found on the phone:** typing a tag offered no "Create tag", so no colour panel, and the typed name was dropped on Save. The suggestion list is placed absolutely, and the tag box had no positioned box around it, as an ingredient or equipment row has, so the list was placed against the page, below the bottom of the screen. A wrapper fixes it (PR #32, CI green); redeployed, and tags checked again on the phone. The tests had missed it: jsdom doesn't lay pages out, and Playwright scrolls to whatever it clicks. `expectJustUnder()` in `e2e/helpers.ts` now checks the tag, equipment and ingredient suggestions open just under their boxes; without the fix it fails, with the tag list 547 px below its box.
  - **The photo:** downloaded from the Pi, the full size (1506×2000, upright) and the thumbnail (301×400) hold only image data, with no EXIF or XMP, so no GPS position.
  - **Backups:** you ran `backup.sh` (the dump and its `.media.tar`), `restore-check.sh` (the image check passed) and `offsite.sh`, and the B2 copy lists the `.media.tar`.
  - **Not shown on the phone:** the recipe left on the Pi has no ingredient lines, so grouping lines by section is covered by `sections.spec.ts` in CI rather than on the phone.
  - **Docs:** `docs/api.md` and `docs/erd.md` say the column is gone (PR #31); the README's status and `docs/api.md`'s opening line now that 3b is done.

  Next: this plan ends with Phase 3. Phase 4 (hardening and monitoring, in the Backlog) needs a plan of its own. Still open: the SSD (8.1).
- **2026-11-26:** Recipe import beyond URLs added to the Backlog, from your question: a saved HTML file first, then PDFs, photos and pasted text with an AI model as an option, each opening the editor filled in. Its phase is decided with the next plan.
- **2026-11-26:** Phase 4's plan written: Steps 27–32, after you settled D16–D19.
  - **Found first:** log rotation already done for Docker's logs (Step 8); no alerts of any kind; four advisories in the API's production dependencies, one critical (`proxy-addr`), all fixed within their major versions; `deploy.sh` never downloads newer Node or Postgres images; Node 22's support ends on 30 April 2027; Prisma pinned at 6.6.0, with 7.10.1 the newest stable and npm's `latest` tag on an 8.0 release candidate.
  - **D16:** Healthchecks.io with ntfy. You asked first how it works for your internet traffic, since you want the setup to talk to the wider internet as little as possible: it's outbound only, one small request every 5 minutes to one fixed host, carrying only the status and the disk use, with the ping addresses and the ntfy topic kept on the Pi.
  - **D17:** Dependabot, weekly. **D18:** Prisma 6.19.3, then 7.10.1. **D19:** Node only, to Node 26; M6 and S1 stay in the backlog.
  - **The order:** the security fixes first, then Dependabot (whose first round brings the rest up to date), alerts, the two Prisma steps, and Node last. Each step that changes the Pi deploys at its end.
  - **Specs:** the design spec's Phase 4 and technical spec §6.3 now name the choices.

  Next: Step 27, security fixes and fresh images on every deploy.
- **2026-11-26:** Phase 4's plan merged (PR #35). Step 27 built: security fixes, and fresh images on every deploy.
  - **The advisories:** `npm audit fix` moved `body-parser` to 2.4.0, `path-to-regexp` to 8.4.2, `proxy-addr` to 2.0.8 (the critical one) and `qs` to 6.17.1, all inside Express's version ranges, so only `package-lock.json` changed; it also moved ESLint and typescript-eslint up a minor version. One dev-only advisory was left, `brace-expansion` 1.1.12 under Jest 29's `glob`, and `npm update brace-expansion` took it to 1.1.22 within its range. `npm audit` now reports nothing, for production or development. The client's two (`glob` and `minimatch`, in ESLint and Workbox's build tools) need breaking updates and never reach the browser: Dependabot's.
  - **Checked first:** npm on Windows can drop other platforms' optional packages from a lockfile, which would break `npm ci` in CI and on the Pi. sharp's 29 platform packages, `linux-arm64` and `linux-x64` among them, are all still there.
  - **Fresh images:** `deploy.sh` now runs `compose pull db` and `compose build --pull api` before building, so each deploy starts from the newest `postgres:17` and `node:22-slim`. Before, the Pi kept the images it first downloaded. `up -d` restarts the database only when its image changed. Both commands were checked with Compose's `--dry-run` against the production file.
  - **Docs:** the runbook (what a deploy downloads, a command for the running PostgreSQL version, and why PostgreSQL 18 is a task of its own) and the README's deploy line.
  - **Tests:** 575 Jest, 311 Vitest, and 70 end-to-end in Chromium, all passing; lint and type-check clean.

  Next: your deploy, then Step 28, Dependabot.
- **2026-11-26:** Step 27 merged (PR #36, CI run #75 green) and deployed: "Deploy OK", with the newest images downloaded, and the Pi answers its health check. Step 27 done.

  Next: Step 28, Dependabot.
- **2026-11-27:** Step 28 done: Dependabot opens weekly pull requests, and its first round is settled.
  - **The config** merged as PR #37, and you turned on Dependabot alerts and security updates. Dependabot opened 12 pull requests within minutes (#38–#49), and CI ran all three jobs on each.
  - **Merged, all green:** `checkout`, `setup-node` and `upload-artifact` v7 (#38–#40), which also end the runs' "Node.js 20 is deprecated" warnings; the client's minor and patch group (#42); the API's (#46), with Express 5.3.0; `cross-env` 10 (#49), now Node 20 or later and ESM only, with the same command; and React Router 8 (#44), which is ESM only and asks for Node 22.22 and React 19.2.7 or later. It passed both browsers in CI, and the client's type-check, lint, 311 unit tests and build here.
  - **Closed with `@dependabot ignore this major version`:** TypeScript 7 in both folders (#45, #47): `npm ci` failed, as `ts-jest` takes TypeScript below 7 and `typescript-eslint` below 6.1 (Backlog). `jsdom` 31 (#43): it needs Node 22.15 or later just to load (Node's zstd support), so this PC's 22.13.1 can't run the client's tests with it, and it fails one focus test; it comes back in Step 32.
  - **Replaced by `phase-4/step-28-jest-dotenv`:** Jest 30 (#41): its lockfile nested a copy of `jest-util` inside each Jest package and none at the top, where `ts-jest` looks, so no test could start. The same versions installed from `main` give one `jest-util`, and all 575 tests pass. `dotenv` 18 (#48): it brings a `dotenv` command of its own, as `dotenv-cli` did, and in CI dotenv's won, so `npm test` got its usage text. `npm test` now uses `dotenv run -q --override -f .env.test` and `dotenv-cli` is gone. That command stops if `.env.test` is missing, where `dotenv-cli` carried on silently, so CI writes one from its `DATABASE_URL`. The override still beats an inherited `DATABASE_URL`, checked with the dev database's URL set: the tests used `miseenplace_test`. `globalSetup` loads it quietly, since dotenv 17 prints a line per file.
  - **On the Pi:** none of this is deployed yet. Express 5.3.0 and dotenv 18 in the API, and React Router 8 and the new TanStack Query in the client it serves, go out with the next deploy (Step 29's).
  - **Tests:** on the branch, rebased onto the merged round: 575 Jest, 311 Vitest and 70 end-to-end in Chromium, all passing; lint and type-check clean in both projects.

  Next: Step 29, alerts.
- **2026-11-27:** Step 29 built: alerts through Healthchecks.io and ntfy (D16).
  - **`scripts/monitor.sh`:** every 5 minutes, the API's health check on `127.0.0.1:3000` and on the `ts.net` address, retried for 30 seconds so a deploy's restart doesn't count, and the fuller of the disks holding Docker's data and the backups. Then one ping: "ok, disk 41%", or to `/fail` with only what failed. A pause file silences it during maintenance, since any ping, a failed one too, resumes a paused check.
  - **`scripts/nightly.sh`:** replaces the cron line's `(backup.sh && offsite.sh)`: the same two, then "ok" or "backup failed" / "offsite failed", never their output. Without `alerts.env` the backup still runs.
  - **Both** read `~/.config/miseenplace/alerts.env` (two ping URLs, the `ts.net` address, the disk limit), kept on the Pi only, and send with `curl -fsS -m 10 --retry 3`.
  - **Checked here** against a stand-in for Healthchecks that recorded every request, and the real API (see the box above). Each request carried only curl's standard headers and the short status.
  - **Docs:** the runbook's new section 9 (what leaves the Pi, what each alert means and what to look at first, the setup, the cron lines, the logrotate rule, the four alert checks, and pausing), the SSD move pausing both checks, and `docs/architecture.md`'s Pi diagram with Healthchecks and ntfy, outbound only.
  - **Also:** the local Browser pane configs moved from `dotenv-cli`'s options to dotenv 18's `dotenv run` with `cross-env` (Step 28 had removed `dotenv-cli`).

  Next (you): deploy, which brings the scripts and Step 28's updates to the Pi, then the runbook's section 9 and each alert on the phone.
