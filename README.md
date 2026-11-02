# mise-en-place

[![CI](https://github.com/A-W-Coding/mise-en-place/actions/workflows/node.js.yml/badge.svg)](https://github.com/A-W-Coding/mise-en-place/actions/workflows/node.js.yml)

A personal recipe API, built with Express 5, TypeScript, Prisma 6.6 and PostgreSQL 17.

Phase 1, the backend API, is complete. Phase 2 puts it on a Raspberry Pi, reachable over Tailscale HTTPS. The plan, decisions and progress are in [`planning/PLAN.md`](planning/PLAN.md).

## Prerequisites

- **Node.js 22**, version 22.13 or later. `.nvmrc` pins the major version, so `nvm use` picks it up.
- **Docker**, with Compose: Docker Desktop, or Docker Engine with the Compose plugin.

## Setup

```bash
# 1. Install dependencies
npm ci

# 2. Configure: copy the template, then change the password in both places
cp .env.example .env

# 3. Start PostgreSQL
docker compose up -d db

# 4. Apply the migrations to the dev database
npx prisma migrate deploy

# 5. Optionally, load the sample recipe
npm run seed

# 6. Start the API on port 3000, and check it can reach the database
npm run dev
curl http://localhost:3000/api/health      # {"status":"ok"}
```

`docker-compose.yml` is for development only: PostgreSQL, reachable from this machine alone. The Pi uses `docker-compose.prod.yml` (see [Deployment](#deployment)).

### The test database

Tests use their own database, `miseenplace_test`, in the same container. On the first start with an empty volume, `docker/initdb/` creates it. If your volume is older than that script, create it once:

```bash
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" miseenplace_test'
```

Then create `.env.test` (git-ignored) with one line, using the same user and password as `.env`:

```
DATABASE_URL=postgresql://miseenplace:change-me@localhost:5432/miseenplace_test
```

`npm test` applies the migrations to it itself.

## Environment variables

| Variable | Used by | Description |
|---|---|---|
| `DATABASE_URL` | API, Prisma, seed, tests | PostgreSQL connection string. Dev must name a database ending in `_dev`, tests one ending in `_test` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Docker Compose | Create the database user and the dev database on the container's first start |
| `PORT` | API | Port to listen on. Default `3000` |
| `CORS_ORIGINS` | API | Optional. Comma-separated origins a browser may call the API from, such as `http://localhost:5173`. Unset means none |
| `NODE_ENV` | Seed, tests | When `production`, the seed and the test reset refuse to run |

`.env` and `.env.test` are git-ignored; [`.env.example`](.env.example) is the template. Prisma and the server read `.env`, but never override a variable that's already set in your shell. `npm test` is the exception: it loads `.env.test` over anything already set, so tests can't be pointed at another database by accident.

### Safety guard

The test reset and the seed both delete every row before inserting their data. Before touching anything, they check the database name in `DATABASE_URL`: the test reset runs only against names ending in `_test`, and the seed only against `_test` or `_dev`. Anything else stops with an error, and nothing is deleted.

## Commands

| Task | Command |
|---|---|
| Start PostgreSQL | `docker compose up -d db` |
| Install dependencies | `npm ci` |
| Apply migrations | `npx prisma migrate deploy` |
| Create a migration after changing `schema.prisma` | `npx prisma migrate dev --name <name>` |
| Regenerate the Prisma client | `npx prisma generate` |
| Load the sample data (`_dev` or `_test` only) | `npm run seed` |
| Run the API with live TypeScript (port `PORT`, default 3000) | `npm run dev` |
| Build to `dist/`, then run the build | `npm run build`, then `npm start` |
| Lint | `npm run lint` |
| Type-check | `npx tsc --noEmit` |
| Run all tests | `npm test` |
| Run all tests with coverage | `npm test -- --coverage` |
| Run one test file | `npm test -- tests/recipe-api.test.ts` |
| Run tests by name | `npm test -- -t "should delete a recipe"` |

If `prisma migrate dev` ever offers to reset the database, say no and find out why first: a reset deletes all its data.

## Tests

Run tests with `npm test`, which sets up the environment Jest needs. It:

1. loads `.env.test`, and refuses to continue unless `DATABASE_URL` names a `_test` database
2. applies the migrations once, before any test file runs
3. runs the test files one at a time, because they share one database
4. resets the database to the sample data before each test, and empties it after

There are 220 tests in [`tests/`](tests): integration tests that send real requests to the API with Supertest, and unit tests for the request schemas, the units list and the helpers. `npm test -- --coverage` prints a coverage table and writes an HTML report to `coverage/lcov-report/index.html`.

The tests don't type-check (ts-jest only transpiles), so run `npx tsc --noEmit` as well.

### CI

GitHub Actions runs on every pull request into `main` and every push to `main`. It starts a PostgreSQL 17 service, then runs lint, the type-check and the tests with coverage, and puts a coverage table on the run's summary page.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | 200 `{"status":"ok"}` if the database answers, otherwise 503 |
| GET | `/api/recipes` | List recipes. `?search=`, `?limit=`, `?offset=` |
| GET | `/api/recipes/:id` | Get a recipe with its ingredient lines |
| POST | `/api/recipes` | Create a recipe, optionally with its lines |
| PATCH | `/api/recipes/:id` | Update a recipe. An `ingredients` array replaces every line |
| DELETE | `/api/recipes/:id` | Delete a recipe and its lines |
| GET | `/api/ingredients` | List ingredients. `?search=`, `?limit=`, `?offset=` |
| GET | `/api/ingredients/:id` | Get an ingredient |
| POST | `/api/ingredients` | Create an ingredient. 409 if the name exists |
| PATCH | `/api/ingredients/:id` | Rename an ingredient. 409 if the name exists |
| DELETE | `/api/ingredients/:id` | Delete an ingredient. 409 while a recipe uses it |

Lists return a JSON array, with the total across all pages in the `X-Total-Count` header. [`docs/api.md`](docs/api.md) has every parameter, body, response and error.

A quick try, with the sample data loaded:

```bash
curl -i "http://localhost:3000/api/ingredients?search=onion"
curl -X POST http://localhost:3000/api/ingredients \
     -H "Content-Type: application/json" -d '{"name": " Shallot "}'     # stored as "shallot"
```

## Deployment

From Phase 2 the API runs on a Raspberry Pi, in Docker, on `127.0.0.1:3000` only. `tailscale serve` publishes it over HTTPS to your own devices, and the database has no published port. `scripts/deploy.sh` backs up, pulls `main`, builds, migrates and waits for the health check; `scripts/backup.sh` runs daily from cron. [`docs/deployment.md`](docs/deployment.md) covers the setup, from the operating system to the restore test.

## Project structure

```
src/
  app.ts                 The Express app: CORS, JSON parsing, routes, error handler (tests import it)
  server.ts              Loads .env and starts listening
  units.ts               The canonical unit list and canonicaliseUnit()
  routes/                health, recipes, ingredients
  schemas/               Zod schemas for every request body and list query
  middleware/            CORS policy and the error handler
  utils/                 Validation, fuzzy search, Prisma error helpers
prisma/
  schema.prisma          The database schema
  migrations/            SQL migrations, applied in order
  client.ts              The shared PrismaClient
  seeds/                 The sample data (base-seed.ts) and its command-line entry point (run.ts)
  utils/                 The database guard and the test reset helpers
tests/
  *.test.ts              Integration and unit tests
  helpers/               Jest global setup and per-test lifecycle
docker/initdb/           Creates the test database on a fresh volume
docker-compose.yml       PostgreSQL for development
docker-compose.prod.yml  The Pi: the API and PostgreSQL
Dockerfile               The API's production image
docs/                    API reference, ERD, architecture, deployment
planning/                The hardening plan, code audit, design review and specs
scripts/                 Deploy, backup and restore-check scripts for the Pi, and a CI helper
```

## Documentation

- [`docs/api.md`](docs/api.md): the API reference
- [`docs/erd.md`](docs/erd.md): the database schema as an entity-relationship diagram
- [`docs/architecture.md`](docs/architecture.md): how the pieces connect, now and from Phase 2
- [`docs/deployment.md`](docs/deployment.md): setting up the Pi, deploying, backups and restores
- [`planning/`](planning): the hardening plan, the code audit, the design review, and the technical and design specs
