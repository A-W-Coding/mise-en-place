> Written on 27 September 2026. This is the live copy, kept up to date in the repo.

# Mise en place: design review findings

This is the reference behind `PLAN.md`. It covers every finding from the review of the design spec and technical spec (not the code, which `code-audit.md` covers). Each entry gives the problem, why it matters, the fix, and where the plan deals with it.

**The verdict:** the project is viable, and several fundamentals are already right: building the API first with tests, Tailscale instead of port forwarding, Restrict on ingredient deletes, and CI that never reaches into the home network. The four most important issues are:
1. The Phase 3 PWA can't work over plain HTTP on the home network (F1).
2. The test reset and the deploy script can each destroy real data (T1, T3).
3. The sync design misses several kinds of change (F2).
4. The Spoonacular caching plan breaches Spoonacular's terms (V1).

IDs: **S** security, **F** functionality, **T** testing and deployment, **V** viability, **M** minor.

---

## Security

### S1. No authentication, so network location is the only access control
- **Problem:** from Phase 2, anyone on the home Wi-Fi (guests, smart-home devices) can read, edit and delete everything. An unauthenticated API with permissive CORS can also be driven by a malicious web page opened on that network.
- **Fix:**
  - Bind the API to localhost on the Pi, and publish it with `tailscale serve`. Serve proxies a local port to an HTTPS address on your tailnet, and adds headers identifying the requester's login.
  - Optionally, check that the login is yours. Users you've shared the device with get these headers too.
  - Keeping the API on localhost is what makes the headers trustworthy. Anyone who could reach the service directly could supply their own values.
  - Lock CORS to your own origin.
- **Handled in:** Step 5.7 (CORS) and Step 8.2, 8.3 and 8.5.

### S2. Postgres is exposed
- **Problem:** `'5432:5432'` publishes the database on every network interface, and Docker's published ports bypass UFW, so a host firewall won't protect it.
- **Fix:** on the Pi, don't publish the port at all; the API reaches the database over the Compose network. In development, bind it as `127.0.0.1:5432:5432`.
- **Handled in:** Step 3 (dev) and Step 8.3 (Pi).

### S3. Never pass `req.body` straight to Prisma
- **Problem:** Prisma accepts nested writes, so an unvalidated body can also create, relink or delete related rows.
- **Fix:**
  - Validate every route against an explicit schema. Zod works well with TypeScript.
  - Reject unknown fields, and build Prisma's `data` from known fields only.
  - Map Prisma errors to proper statuses. For example, a blocked ingredient delete should return a 409 listing the recipes that use it, not a 500. The code already returns 409 for this.
- **Handled in:** Step 2 (check) and Step 5.1.

### S4. Image uploads are the largest attack surface (Phase 3)
- **Fix:**
  - Check the file type from its contents, not its extension.
  - Cap the file size and the pixel dimensions.
  - Generate filenames on the server.
  - Reject SVG.
  - Re-encode every image with sharp. Re-encoding also strips EXIF data, which matters because phone photos often carry GPS coordinates and Phase 5 adds sharing.
- **Handled in:** the Phase 3 gate (D11).

## Functionality

### F1. The Phase 3 PWA won't work as phased
- **Problem:** service workers, PWA installation and the Screen Wake Lock API all require a secure context (HTTPS). Over `http://192.168.x.x` you'd lose offline caching, proper installation and the keep-awake cooking mode. The LAN address and the Tailscale address are also different origins, so a phone would end up with two installs and two separate offline caches.
- **Fix:**
  - Move Tailscale into Phase 2, and use one `*.ts.net` HTTPS hostname everywhere, including at home.
  - Serve only works once HTTPS certificates are switched on for the tailnet.
  - Those hostnames appear in public certificate-transparency logs, so give the Pi a bland name.
- **Handled in:** D5 and Step 8.2.

### F2. Timestamp-based sync misses three kinds of change
- **Problems:**
  - Ingredient, Tag and Equipment have no `updatedAt`, yet the sync response returns ingredients.
  - Edits through child endpoints, such as `PATCH /api/sections/:id`, never touch the Recipe row, so the recipe's `updatedAt` doesn't change.
  - Deletes are hard deletes, so a recipe deleted on the laptop stays in the phone's offline cache forever.
- **Fix, option A:** update the parent recipe's `updatedAt` in the same transaction as every child write, and add a tombstone table that records deletions.
- **Fix, option B:** simpler at personal scale. Serve a full snapshot with an ETag, and add delta sync only if it's ever needed.
- **Handled in:** Step 4 gives Ingredient timestamps. Step 5.3 sets the recipe's `updatedAt` on every PATCH. The sync design itself is chosen at the Phase 3 gate (D8).

### F3. A single user can still create conflicts
- **Problem:** one person with a phone and a laptop can edit the same recipe on both.
- **Fix:** keep offline mode read-only for now. Alternatively, send the last-seen `updatedAt` with each PATCH and return 409 when it's stale. The spec's UUID rationale mentions creating recipes offline, which only works if the API accepts client-generated ids.
- **Handled in:** the Phase 3 gate (D9).

### F4. Fix the ingredient model before there's real data
- **Problems:**
  - `Ingredient.name` isn't unique, although Tag and Equipment names are, so normalisation doesn't actually prevent duplicates.
  - `RecipeIngredient` has no order field, so ingredients come back in no guaranteed order, even though instructions get `stepNumber`.
  - There's no preparation note, so "finely diced onion" becomes a new ingredient.
  - Eventually a line needs an optional section link, for groupings like "for the sauce".
- **Fix:**
  - Add `@unique` to the name, and find-or-create on write.
  - Plan a merge feature for synonyms, such as "scallion" and "spring onion".
  - Add `orderIndex` and `note`.
  - Add `sectionId` in Phase 3.
- **Handled in:** Steps 4, 5.2 and 5.3. The section link waits for Phase 3.

### F5. Quantities and units
- **Problems:**
  - `quantity Float @default(0)` can't tell "to taste" from zero.
  - Ranges such as "2–3 cloves" can't be stored.
  - ⅓ cup is stored as 0.333…, which displays badly.
  - A required free-text `unit` forces a fake unit onto "3 eggs".
  - "g", "gram" and "grams" will never aggregate on a shopping list.
  - Unit conversion can't live only in the UI. Shopping-list generation runs on the server, and the nutrition fallback needs grams, which requires converting volume to weight using a density per ingredient.
- **Fix:**
  - Make `quantity` nullable, add `quantityMax`, and format values back to fractions in the UI.
  - Make `unit` nullable, and match it against a fixed list of units with aliases.
  - Put units in a shared TypeScript module that both client and server use.
- **Handled in:** Step 4 (schema) and Step 5.1 (the units module). Fraction display is Phase 3; conversions are Phase 6.

### F6. Gaps in the API
- **Problems:**
  - Phase 1 never defines how a recipe's ingredient lines are created or replaced.
  - Phase 3 has no instruction CRUD, no way to attach tags or equipment to a recipe, and no DELETE for sections, links or equipment.
- **Fix:** specify a nested payload that replaces the whole list inside a transaction, and add the missing Phase 3 endpoints.
- **Handled in:** Step 5.3 (Phase 1) and the Phase 3 gate.

### F7. Problems in the later-phase schema
- `Image.isPrimary` allows several primary images per recipe. A nullable `primaryImageId` on Recipe prevents that.
- `MealPlanEntry.recipeId` is required, and Prisma defaults required relations to Restrict. Any recipe that has ever been meal-planned would become undeletable. Choose Cascade, or make the field optional with SetNull.
- Meal-plan dates should use `@db.Date` to avoid off-by-one-day timezone bugs.
- ShoppingListItem needs a CHECK constraint so that exactly one of `ingredientId` and `customItem` is set.
- The design doc's ingredient categories never made it into the technical spec's schema.
- Phase 5 promises shopping lists, but their tables aren't created until Phase 6.
- **Handled in:** the Phase 3 gate (images) and the backlog for Phases 5 and 6.

## Testing and deployment

### T1. The tests can wipe real data, and will be flaky
- **Problems:**
  - `resetWithBaseSeed()` deletes every recipe. One wrong `DATABASE_URL`, such as running the tests or `npm run seed` on the Pi, erases the collection.
  - Jest runs test files in parallel, so one file's `beforeEach` reset can delete rows in the middle of another file's test.
  - `migrate deploy` in a `beforeAll` runs once per test file.
- **Fix:**
  - Make the reset refuse to run unless the database name ends in `_test`, and give tests their own database.
  - Use `--runInBand` (or a separate schema per worker), and move `migrate deploy` into `globalSetup`.
  - Export the Express app separately from `listen()` and pass the app to Supertest. The code already does this.
- **Handled in:** Steps 2 and 3.

### T2. The CI workflow won't run as written
- **Problems:**
  - It sets no `DATABASE_URL`.
  - It has no Postgres health check, so migrations can run before the database is ready.
  - It uses v3 actions and doesn't specify a Node version.
  - It leaves out the lint and coverage steps that the design doc promises.
- **Handled in:** Steps 2 and 3.

### T3. The deploy script can destroy the only backup
- **Problem:** `$POSTGRES_USER` and `$POSTGRES_DB` are expanded by the host shell, where they're probably unset, so `pg_dump` fails. By then the `>` redirect has already emptied `backup.sql`, and without `set -euo pipefail` the deploy carries on regardless.
- **Other problems in the same script:**
  - It runs `down` before building, and builds on ARM are slow.
  - It runs migrations after the new API has started.
  - It doesn't check that the Prisma CLI is in the production image.
  - It runs the health check once, with no retry, and doesn't fail the deploy.
  - It assumes container names (`recipe-db`, `recipe-api`) that the Compose file never defines.
- **Fix:**
  - Use timestamped backups and check that each one isn't empty.
  - Build before stopping anything, and migrate before starting.
  - Include the Prisma CLI in the production image.
  - Retry the health check, and fail the deploy if it doesn't pass.
  - Address services through `docker compose exec` or `run` rather than container names.
- **Handled in:** Step 8.3, 8.4 and 8.6.

## Viability

### V1. Spoonacular's terms rule out long-term storage
- **Problem:** Spoonacular's terms allow caching for at most one hour, after which the data must be deleted and re-fetched. They also require deleting everything obtained from the API if you stop using it. The planned 90–180 day cache is a clear breach.
- **Fix:** use USDA FoodData Central instead. It costs nothing beyond a data.gov key, the data is public domain (CC0), and it allows 1,000 requests per hour by default. The spec's local-calculation fallback needs exactly this per-ingredient data anyway, so it can become the primary path. Keep Spoonacular only for live, uncached extras such as substitutions.
- **Handled in:** D12, in Phase 6.

### V2. Drop Electron, or at least defer it
- **Problem:** an installed PWA already gives a standalone desktop window with offline support, from one codebase and one deploy. Electron adds packaging, signing and updates. A separately shipped desktop build can also fall out of step with the unversioned API.
- **Fix:** drop or defer Electron. If you keep it, leave context isolation and sandboxing switched on, because an XSS bug in Electron can become code execution.
- **Handled in:** the Phase 3 gate (D7).

### V3. Phase 3 is overloaded
- **Problem:** Phase 3 contains the UI, PWA, offline caching, sync, images, tags, equipment, sections, links, cooking mode, Electron and the print stylesheet, while Phases 2 and 4 are small. This is where solo projects tend to stall.
- **Fix:** split it into three steps: the UI on the Phase 1 schema, including cooking mode; then structured instructions, images and tags; then offline support. For offline reading, a service worker plus TanStack Query's IndexedDB persistence gets most of the way without a custom sync engine.
- **Handled in:** the Phase 3 gate (D10).

### V4. The Pi needs to be made durable
- **Problems and fixes:**
  - PostgreSQL on an SD card is the likeliest way to lose data, so boot from an SSD.
  - Use 64-bit Raspberry Pi OS. The community project that used to publish Prisma engine builds for the Pi now tells users to switch to the 64-bit OS instead.
  - Back up the images directory as well as the database, keep an encrypted copy off the Pi, and test a restore.
  - Tailscale device keys expire after 180 days by default, and connections stop working when they do. Tailscale suggests disabling expiry for trusted servers.
- **Handled in:** Step 8.1, 8.2 and 8.7.

### V5. The spec is written for older versions
- **Prisma:** the spec's schema uses Prisma 6 conventions. In Prisma 7:
  - the `prisma-client-js` generator is replaced by `prisma-client`, which requires an output path
  - `url` in the datasource block is deprecated in favour of `prisma.config.ts`
  - every database needs a driver adapter; for Postgres that's `@prisma/adapter-pg`
- **Prisma 8:** on 27 September 2026, npm's `latest` tag for `prisma` pointed at `8.0.0-rc.17`. An unpinned install could pull a release candidate of yet another major version.
- **Postgres:** PostgreSQL 15 reaches end-of-life on 11 November 2027.
- **Fix:** pin the exact Prisma version now, and upgrade later as its own task, once you've read that version's upgrade guide. Start on a newer Postgres.
- **Handled in:** D3 and D4 (Step 1). The Prisma upgrade is in the Phase 4 backlog.

## Minor

### M1. The documents disagree with each other
- The ERD shows `Int` ids throughout, but the spec says UUID.
- The architecture diagram shows Express reading Postgres directly, with Prisma connected to nothing.
- RecipeLink is in Phase 3 in the technical spec, but in Phase 6 in the design spec.
- Timers appear in both Phase 3 and Phase 6.
- **Handled in:** Step 7 (the ERD and the diagram). The phase clashes are in the Phase 6 backlog.

### M2. Indexes
- Postgres doesn't index foreign keys automatically, so add `@@index` on `recipeId` and `ingredientId`.
- Prisma's case-insensitive `contains` becomes `ILIKE '%term%'`, which can't use a normal B-tree index. That doesn't matter at this scale, but add `pg_trgm` with a GIN index for fuzzy search.
- **Handled in:** Steps 3 and 4.

### M3. UUIDs are a fine choice, but not a security measure here
`GET /api/recipes` lists every id, and there's no authentication. The spec's rationale should say UUIDs help with offline creation and syncing, not with security.
- **Handled in:** Step 7 (the schema segment).

### M4. Keep the database files out of the repo
`./postgres-data` sits inside the repository, so running `git clean -fdx` would delete the database. Use a named Docker volume, and make sure `.env` is git-ignored.
- **Handled in:** Steps 2 and 3.

### M5. URL import needs two precautions (Phase 6)
- Block private IP ranges, so nobody can use the Pi to probe the home network (SSRF).
- Parse the schema.org Recipe JSON-LD that most recipe sites embed, rather than scraping their HTML.
- **Handled in:** the Phase 6 backlog.

### M6. Add a JSON export early
Exporting all data as JSON is cheap insurance, and lets you move the data elsewhere without depending on Postgres backups.
- **Handled in:** the backlog, any time after Step 6.

---

## Sources
- Spoonacular caching and deletion terms: [spoonacular pricing and terms](https://spoonacular.com/food-api/pricing)
- USDA FoodData Central keys, rate limits and licence: [FoodData Central API Guide](https://fdc.nal.usda.gov/api-guide)
- Prisma 7 changes: [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-to-prisma-7)
- Declaring GIN and trigram indexes in Prisma: [Prisma indexes](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes), and a worked example of the drift problem in [opencupid PR #1517](https://github.com/opencupid/opencupid/pull/1517)
- Tailscale Serve (HTTPS, identity headers, listening on localhost): [Tailscale Serve](https://tailscale.com/kb/1312/serve)
- Tailscale key expiry: [Key expiry](https://tailscale.com/kb/1028/key-expiry)
- Prisma on 32-bit Pi builds: [prisma-rpi-builds](https://www.github.com/forabi/prisma-rpi-builds)
- PostgreSQL end-of-life dates: [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- The Postgres 18 Docker data-directory change: [postgres official image](https://hub.docker.com/_/postgres) and [docker-library/postgres#1370](https://github.com/docker-library/postgres/issues/1370)
- Features restricted to HTTPS: [MDN: features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts/features_restricted_to_secure_contexts)
- Docker's published ports bypassing UFW: [Baeldung: Docker published ports ignoring UFW](https://www.baeldung.com/linux/docker-container-published-port-ignoring-ufw-rules)
