# Architecture

How the pieces connect: first in development today (Phase 1), then on the Raspberry Pi from Phase 2. GitHub draws the diagrams; in an editor, they need a Mermaid preview.

## Phase 1: development

```mermaid
flowchart LR
    client["curl, or Supertest in the tests"]

    subgraph api["Express API (Node 22, port 3000)"]
        direction TB
        cors["CORS policy<br/>(CORS_ORIGINS)"] --> json["JSON body parser"]
        json --> routes["Routes<br/>health, recipes, ingredients"]
        routes --> zod["Zod schemas<br/>validate and normalise"]
        routes -.->|errors| handler["Error handler<br/>409, 4xx, generic 500"]
    end

    prisma["Prisma Client"]
    db[("PostgreSQL 17 in Docker<br/>127.0.0.1:5432<br/>miseenplace_dev, miseenplace_test")]

    client --> cors
    zod --> prisma
    prisma --> db
```

- Every request passes through the CORS policy and the JSON parser, then a route. The route validates its input with a Zod schema before any database call.
- Requests reach the database only through Prisma. Fuzzy search uses Prisma's `$queryRaw` for its trigram SQL.
- The database is published on 127.0.0.1 only. The tests use `miseenplace_test`, and a guard refuses to reset any other database.

## From Phase 2: the Raspberry Pi

```mermaid
flowchart LR
    subgraph devices["Your devices, on the tailnet"]
        pwa["React PWA<br/>phone, laptop (Phase 3)"]
        shell["curl, scripts"]
    end

    subgraph pi["Raspberry Pi"]
        serve["Tailscale serve<br/>HTTPS on name.tailnet.ts.net"]
        api["Express API<br/>127.0.0.1:3000"]
        prisma["Prisma Client"]
        db[("PostgreSQL 17<br/>Compose network only")]
        images["Image store<br/>(Phase 3)"]
        backups["Daily pg_dump to the SSD,<br/>plus an encrypted copy off the Pi"]
    end

    pwa -->|HTTPS over the tailnet| serve
    shell -->|HTTPS over the tailnet| serve
    serve --> api
    api --> prisma --> db
    api -.-> images
    db -.-> backups
```

- Only `tailscale serve` is reachable from other devices, and only over the tailnet. The same `https://…ts.net` address works at home and away, so the PWA has one origin and HTTPS everywhere (F1).
- The API listens on 127.0.0.1, and the database has no published port at all.
- Electron isn't shown: decision D7 (at the Phase 3 gate) recommends dropping or deferring it in favour of the installed PWA.
