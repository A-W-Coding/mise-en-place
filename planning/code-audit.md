# Mise en place: Phase 1 code audit

> Rewritten on 27 October 2026 from the code on `main` at commit `8e61e98`. The original audit was lost. This version keeps its A1–A10 numbering, and takes the topic of each ID from the way `PLAN.md` cites it.

This is the reference behind the `A` IDs in `PLAN.md`. It checks whether the code matches the technical spec (`specs/technical-spec.md`). Whether the spec itself is right is covered by `design-review.md`.

## How to read this
- **Status:** ❌ a problem, ⚠️ partly right, ✅ fine.
- **How each claim was checked:**
  - *(read)*: established by reading the code and config.
  - *(ran)*: confirmed by running a command. The only command run was `npx jest --listTests`, which lists test files without running them or touching a database.
  - **Unverified**: would need the server, the tests, a database or CI to confirm. Nothing was run against a database, and CI results weren't visible because the `gh` CLI isn't installed in this shell.
- **ID topics:** A4 and A9 are both cited only by Step 6, so the split between them (integration tests vs unit tests and coverage) is inferred. The other topics follow directly from the plan.

## Baseline: the plan's "What already exists", checked
| Claim in PLAN.md | Result |
|---|---|
| Schema matches the spec field for field (UUID keys, `servings @default(1)`, `quantity @default(0)`, Cascade from Recipe, Restrict from Ingredient) | ✅ `prisma/schema.prisma` matches the "Current Prisma Schema" block in spec §2.1; only comments differ *(read)* |
| All ten CRUD endpoints exist, and recipes come back with ingredients nested | ✅ five each in `src/routes/recipes.ts` and `src/routes/ingredients.ts`; `RECIPE_INCLUDE` nests `recipeIngredients → ingredient` *(read)* |
| P2025 → 404 | ✅ PATCH and DELETE on both resources. The GET-by-id routes return 404 when `findUnique` gives `null` *(read)* |
| P2003 → 400 for a bad ingredient reference in a recipe body | ✅ `recipes.ts:154` (POST) and `recipes.ts:207` (PATCH); both have tests *(read)* |
| P2003 → 409 when deleting an in-use ingredient | ✅ `ingredients.ts:159`, with a test *(read)* |
| Ingredient names lowercased and trimmed; duplicate POST → 409 through a pre-check only | ✅ on both POST and PATCH. The 409 comes from a `findFirst` pre-check on POST only (A1) *(read)* |
| One `?search=` parameter using pg_trgm and ILIKE, ranked by similarity | ✅ ranking uses `word_similarity`, and ILIKE-only hits get a floor score of 0.5 (A3) *(read)* |
| Supertest integration tests cover happy paths, 400/404/409, cascades and fuzzy ranking | ✅ 43 tests in three files: recipes 18, ingredients 14, fuzzy search 11 *(read)* |
| `app` is exported separately from the server | ✅ `src/app.ts` exports `app`; `src/server.ts` calls `listen()`. No test imports the server *(read)* |

## Findings

### A1. Ingredient names aren't unique in the database ❌
**Plan:** Steps 4, 5.2 and 6. **Related:** F4.
- `Ingredient.name` has no `@unique` (`schema.prisma:51`) *(read)*.
- POST checks for a duplicate with `findFirst` and then calls `create` (`ingredients.ts:95–106`). Two simultaneous POSTs of the same new name can both pass the check and both insert *(read; the race itself is **unverified**)*.
- PATCH has no duplicate check at all (`ingredients.ts:125–128`). Renaming "garlic" to "onion" succeeds and leaves two "onion" rows *(read)*.
- Nothing maps P2002 (unique violation) anywhere, because no unique constraint exists yet *(read)*.

### A2. Validation and error handling ❌
**Plan:** Steps 5.1 and 5.7. **Related:** S3, D1.
- `src/utils/validation.ts` has one helper, `validateRequiredString`, used only for `name` *(read)*.
- **Recipe fields aren't checked.** `description`, `servings`, `prepTime`, `cookTime` and `instructions` pass straight into Prisma (`recipes.ts:135–142` and `183–187`) *(read)*:
  - Wrong types, such as `servings: "abc"` or `servings: 1.5`, should make Prisma throw a `PrismaClientValidationError`. That error has no `code`, so it reaches the global handler and returns 500 (**unverified**: not run).
  - Negative `servings`, `prepTime` and `cookTime` are stored as given *(read)*.
- **Ingredient lines aren't checked.** `toRecipeIngredientCreateData` (`recipes.ts:45–51`) copies `ingredientId`, `quantity` and `unit` as they are *(read)*:
  - A missing `unit` or `ingredientId`, or a non-numeric `quantity`, should also give a 500 (**unverified**). The old audit's advice to validate that `unit` is present was never carried out.
  - A missing `quantity` silently becomes 0 (`recipes.ts:48`).
  - An `ingredients` value that isn't an array is silently ignored on both POST and PATCH (`recipes.ts:144`, `190`).
- **S3 (passing `req.body` to Prisma): ✅ not present.** Every handler builds Prisma's `data` from named fields, so a client can't set `id` or `createdAt` or add nested writes. Unknown fields are ignored rather than rejected *(read)*.
- **Error handler** (`src/middleware/error-handler.ts`):
  - ✅ Unknown errors return 500 `{ error: 'Internal server error' }`. The stack goes only to `console.error`, never into the response *(read)*.
  - ❌ It ignores `err.status`, so malformed JSON in a request body, which `express.json()` reports as a 400, comes back as a 500 (**unverified**: not run).
  - Prisma errors are mapped route by route (P2025, P2003). Nothing is mapped centrally *(read)*.
- All error responses already share one shape, `{ error: string }` *(read)*.

### A3. Search ⚠️
**Plan:** Steps 2, 3, 4 and 5.4. **Related:** M2.
- ✅ **pg_trgm is enabled by a migration.** `20260302213608_add_trigram_fuzzy_search` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and creates two GIN indexes. It sorts after every migration that creates tables, and no earlier migration uses trigram functions *(read)*. Whether the extension was also enabled by hand in the dev database is **unverified**.
- ❌ **The GIN indexes exist only in migration SQL**, not in `schema.prisma`. Prisma will see them as drift, so the next `prisma migrate dev` will probably generate a `DROP INDEX` for both (**unverified**: not run). Step 4 should declare them with `map: "recipe_name_trgm_idx"` and `map: "ingredient_name_trgm_idx"` to keep their existing names.
- ❌ **A repeated parameter breaks search.** The routes cast `search as string` (`ingredients.ts:33`, `recipes.ts:67`). Express 5's default query parser turns `?search=a&search=b` into an array, so `searchTerm.toLowerCase()` throws and the request returns 500 (read; **unverified** at runtime).
- ❌ **ILIKE wildcards aren't escaped.** `%` and `_` in a search term act as wildcards, so `?search=%` should match every name (read; **unverified** at runtime).
- ⚠️ **The term isn't trimmed or capped.** `?search=%20` is truthy, so it runs a search for a single space instead of being treated as no search *(read)*.
- ⚠️ **Raw SQL goes through `$queryRawUnsafe`** with the table name interpolated (`fuzzy-search.ts:42–54`). The search term and threshold are bound as `$1` and `$2`, and the table name comes from a TypeScript union, so there's no injection today. The plan still asks for the tagged-template `$queryRaw` (Step 5.4) *(read)*.
- Search has no `LIMIT` (A7). Whether the `word_similarity(...) > $2` filter can use the GIN index is **unverified** (no `EXPLAIN` was run).

### A4. Missing integration tests ❌
**Plan:** Step 6.
Behaviour that exists today but has no test *(read)*:
- PATCH an ingredient to a name that already exists (it currently succeeds; see A1)
- Two simultaneous POSTs of the same name
- Trimming: the only normalisation test posts `"Potato"`, which checks lowercasing but not whitespace
- Invalid types for `servings`, `prepTime`, `cookTime`, `quantity` and `unit`, a missing `unit`, and malformed JSON
- PATCH changes `updatedAt`. The old audit asked for this. Whether `@updatedAt` changes when a PATCH only replaces the lines is **unverified**
- PATCH without `ingredients` leaves the lines alone
- A repeated `search` parameter, and a `%` in a search term
- The health check

Some existing tests assert very little. For example, "should return all seeded ingredients" only checks that the list isn't empty, and the recipe-create test never checks `quantity` or `unit`.

### A5. Test discovery ❌
**Plan:** Steps 2 and 3.
- ✅ Every test file is named `*.test.ts` *(read)*.
- ❌ **Jest also runs the compiled copies in `dist/tests/`.** `npx jest --listTests` lists six files: the three in `tests/` and `dist/tests/*.test.js` *(ran)*. `tsconfig.json` has no `include` or `exclude`, so `npm run build` compiles the tests too. `jest.config.js` has no `roots` or `testPathIgnorePatterns` to skip `dist/`. So `npm test` runs every suite twice, both times against the test database. That the compiled copies pass is **unverified**.
- ❌ **`tests/helpers/jest-setup.ts` is never loaded.** `jest.config.js` has no `setupFiles` or `setupFilesAfterEnv` entry, so its `jest.setTimeout(15_000)` has no effect *(read)*.

### A6. No real health endpoint ❌
**Plan:** Step 5.6.
- The only health check is `GET /` (`app.ts:21–23`). It returns a static `{ message }` and never touches the database *(read)*.
- Spec §3.2 lists `GET /api/health`, which returns 404 today. The spec's deploy script curls that URL *(read)*.

### A7. No pagination, and no stable ordering ❌
**Plan:** Step 5.5. **Related:** D6.
- Spec §3.1 calls for pagination and sorting on list endpoints. Neither list route accepts `limit` or `offset` *(read)*.
- `findMany()` has no `orderBy` (`ingredients.ts:51`, `recipes.ts:86`), so list order isn't guaranteed *(read)*.
- Nested `recipeIngredients` come back unordered, and the schema has no field to order them by *(read)*.
- Search results are ranked, but they're unlimited and ties have no tie-break *(read)*.

### A8. Files the original audit couldn't see
**Plan:** Step 2.
The first audit had no access to these files. This one did, so the table below is a head start on Step 2. It doesn't replace Step 2, which still records a ✅ or ❌ for each item in the Progress log.

| Item | Status | What the files show | Fixed in |
|---|---|---|---|
| pg_trgm migration | ✅ | See A3 *(read)* | n/a |
| Guard on the test reset and seed | ❌ | `cleanDatabase()` (`prisma/utils/db-utils.ts:24–33`) and `seed()` (`prisma/seeds/base-seed.ts:51–53`) delete every row, with no check on the database name or `NODE_ENV` *(read)* | Step 3 |
| Tests use their own database | ⚠️ | `.env.test` points at `mydatabase_test` and `.env` at `mydatabase`, both on `localhost:5432`. The dev name doesn't end in `_dev` *(read; only database names were inspected, not credentials)*. `npm test` loads `.env.test` through `dotenv-cli`. Anything that starts Jest without it (`npx jest`, or the VS Code Jest extension the workspace file recommends) leaves `DATABASE_URL` unset, and Prisma then loads `.env` itself, so the reset would wipe the dev database (read; **unverified**: not run). How `mydatabase_test` was created isn't recorded in the repo | Step 3 |
| How Jest runs | ⚠️ | ✅ `npm test` already passes `--runInBand`. ❌ `prisma migrate deploy` runs through `execSync` in every file's `beforeAll` (`tests/helpers/test-lifecycle.ts:23–27`), so it runs three times per run, or six counting the `dist/` copies. There's no `globalSetup`. ✅ No test calls `server.close()`, because the tests only use `app` *(read)* | Step 3 |
| Test file naming | ❌ | See A5 *(ran)* | Step 3 |
| `req.body` passed to Prisma (S3) | ✅ | Not present; see A2 *(read)* | n/a |
| How recipe bodies refer to ingredients | n/a | By `ingredientId` only. `toRecipeIngredientCreateData` builds `{ ingredientId, quantity: quantity ?? 0, unit }` for a nested `recipeIngredients.create`, so a bad id fails with P2003, which becomes a 400 *(read)* | Step 5.3 keeps this style |
| Error handler | ⚠️ | See A2 *(read)* | Step 5.7 |
| `docker-compose.yml` | ❌ | `'5432:5432'` publishes Postgres on every interface (S2), and the `api` service does the same with `'3000:3000'`. Image `postgres:15`, obsolete `version: '3.8'` key, no healthcheck, and `depends_on` without a health condition. ✅ Data has used a named volume (`postgres-data:`) since commit `8e61e98` on 16 Sept 2026; before that it was the `./postgres-data` bind mount *(read)* | Steps 3 and 8.3 |
| `./postgres-data` in the repo | ⚠️ | Still present: 71 MB, written by Postgres 15. Compose no longer mounts it, so it holds dev data from before 16 Sept 2026, and anything newer is in the Docker volume. Which one holds the data you care about is **unverified**; Docker wasn't inspected. Git ignores it through `*postgres-data` | Step 3 (ask first) |
| CI workflow | ❌ | `.github/workflows/node.js.yml` is still the SQLite-era workflow. It writes `DATABASE_URL=file:./test.db` while the schema's provider is `postgresql`, so `prisma migrate deploy` should fail (read; **unverified**: no CI results seen). It has no Postgres service and never runs the tests, lint or coverage. Node 18, `actions/setup-node@v3`, `actions/checkout@v4` | Step 3 |
| `.gitignore` | ⚠️ | Covered: `.env` plus four named variants, `*postgres-data`, `*.db`, `dist/`. Missing: a general `.env*` pattern *(read)* | Fixed in the setup commit on `setup/planning` |
| `package.json` | ⚠️ | Scripts: `dev`, `build`, `start`, `test`, `seed`. `prisma` and `@prisma/client` are `^6.6.0`, with 6.6.0 locked and installed, so the range can't cross a major version but isn't an exact pin (D3). No `engines` field, no `.nvmrc`. `zod` and `cors` aren't installed. No ESLint or Prettier config, although the workspace file recommends both extensions. `"main": "index.js"` points at a file that doesn't exist *(read)* | Steps 1 (D3), 3 and 5 |
| The seed runs | ❌ | `base-seed.ts` only exports `seed()`, and nothing calls it, so `npm run seed` and `npx prisma db seed` should exit without seeding (read; **unverified**: not run). The entry point was removed in commit `1d19728`. The two commands also use different runners (`tsx` and `node --loader ts-node/esm`) | Steps 3 and 4 (not yet listed) |
| CORS | ✅ | No CORS middleware, and `cors` isn't installed, so browsers block cross-origin calls. There's no wildcard `cors()` *(read)* | Step 5.7 adds an allowlist |
| README and API docs | ⚠️ | See A10 | Step 7 |
| Dockerfile (not in Step 2's list) | ❌ | ✅ Multi-stage, `node:22-slim`, `openssl` installed. ❌ Runs as root. ❌ The `CMD` runs `npx prisma migrate deploy`, but `prisma` is a devDependency and the runtime stage installs with `npm ci --omit=dev`. With no TTY, npx downloads whatever version npm's `latest` tag points to when the container starts (read; **unverified**: not built) | Step 8.4 |
| Leftovers (not in Step 2's list) | ⚠️ | `.vscode/tasks.json` still has SQLite tasks ("Clean Database" deletes `./dev.db`). `prisma/prisma/dev.db` and `test.db` are old SQLite files (ignored). `.env` defines `DATABASE_PORT` with the comment "Express server port", but `server.ts` reads `PORT`. `mise-en-place-cleanup.zip`, a snapshot from 2 March 2026, is committed but used by nothing *(read)* | Not planned |

### A9. No unit tests, and no coverage ❌
**Plan:** Step 6.
- Every test is a Supertest integration test against the database. `isPrismaError`, `validateRequiredString` and `fuzzySearchByName` are only exercised through HTTP *(read)*.
- Nothing reports coverage: no `--coverage` flag and no `collectCoverageFrom` *(read)*.
- Spec §5.1 asks for unit tests of the validation and transformation utilities *(read)*.

### A10. The docs don't match the code ❌
**Plan:** Step 7. **Related:** M1.
- **README** *(read)*:
  - It says Node 18+, but development uses Node 22.13.1 and the Dockerfile uses `node:22-slim`.
  - It tells you to `cp .env.example .env`, but there's no `.env.example`.
  - It lists `GET /` as the health check.
  - It says `npm run seed` re-seeds the database (see A8).
  - It doesn't explain how the test database is set up.
  - Its `docker-compose up -d` now also builds and starts the `api` container.
- **No API reference:** `docs/api.md` doesn't exist *(read)*.
- **The ERD is stale:** `docs/mise-en-place_MVP_ERD.png` (March 2025) shows `Int` ids on all three tables *(read: image viewed)*.
- **Two copies of each spec:** `docs/technical_spec.md` and `docs/design_spec.md` (March 2025) were older versions with a different phase structure. The current ones are in `planning/specs/` *(read)*. Resolved on 27 Oct 2026, when the `docs/` copies were deleted on `setup/planning`.
- **The spec has drifted from the code:**
  - §5.4's test script lacks `dotenv` and `--runInBand`, and its setup calls `server.close()`. The code is better than the spec in both cases.
  - §6.1's Compose file still uses the `./postgres-data` bind mount *(read)*.

## Where the code differs from what PLAN.md assumes
These may need a change to the plan. That's your call, so `PLAN.md` hasn't been edited.
1. **Step 3 says Jest runs files in parallel.** `npm test` already runs them serially with `--runInBand`. The risk remains for a bare `npx jest` (A8).
2. **Step 3 and M4 assume Compose bind-mounts `./postgres-data`.** It switched to a named volume on 16 Sept 2026. The folder is now leftover data rather than live data (A8).
3. **Step 4's "the seed runs" can't pass yet,** because the seed has no entry point (A8). No step adds one.
4. **Step 4's `map:` note applies.** The trigram indexes already exist as `recipe_name_trgm_idx` and `ingredient_name_trgm_idx` (A3).
5. **The dev database is `mydatabase`.** The Step 3 seed guard would refuse it until it's renamed to something ending in `_dev`.
6. **CI is further from the Step 3 target than T2 describes.** It's a SQLite workflow that never runs the tests (A8).
