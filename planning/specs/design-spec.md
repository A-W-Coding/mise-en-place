# Recipe App Design Document
 
## Overview
 
The Recipe App is a personal recipe management system designed to store, organize, and access cooking recipes across multiple devices. This application addresses the common challenge of recipe fragmentation by providing a centralized, self-hosted solution that emphasizes privacy, control, and accessibility. The system will be hosted on a Raspberry Pi with remote access secured through a VPN solution (such as Tailscale), allowing seamless usage from both desktop and mobile devices while maintaining full control over personal data.
 
## Project Vision
 
### Core Purpose
To create a comprehensive recipe management system that combines the joy of cooking with modern software development practices, serving as both a practical tool and a learning platform.
 
### Key Objectives
 
- Create a personal recipe repository that is accessible from anywhere while maintaining complete data ownership
- Implement a modern, responsive user interface that works well on both desktop and mobile devices
- Establish a robust development environment that follows industry best practices for deployment, testing, and maintenance
- Build a system that can evolve over time with new features while maintaining stability
- Provide a seamless user experience with offline capability for recipe viewing
 
### Target User
 
This is a single-user application for personal use. The primary use cases are:
 
1. **Recipe Storage** - Consolidate all recipes in one searchable location
2. **Cooking Reference** - View recipes on phone while cooking in the kitchen
3. **Meal Planning** - Browse recipes when planning weekly meals
 
The application design considers the following user stories:
 
- As a user, I want to store my recipes in a centralized location so I can access them from my kitchen, living room, or while shopping
- As a user, I want to quickly search and filter recipes by ingredients, tags, or preparation time
- As a user, I want to view my recipes even when my internet connection is unavailable
- As a user, I want to easily scale recipe quantities based on serving size
- As a user, I want to add photos to my recipes to remember presentation
- As a user, I want to read recipes easily on my phone while cooking
- As a user, I want to print recipes when needed
 
## System Architecture

The Recipe App is a React web app, installable as a PWA, backed by a Node.js API, with data persistence handled by Prisma and PostgreSQL.

### High-Level Architecture Diagram

```
   Client devices                          Raspberry Pi
┌──────────────────────┐                ┌────────────────────────────────────────┐
│                      │                │                                        │
│  React PWA           │   HTTPS over   │  Tailscale serve                       │
│  (phone, laptop;     │───────────────►│  https://<name>.<tailnet>.ts.net       │
│   Phase 3)           │   the tailnet  │           │                            │
│                      │                │           ▼  127.0.0.1:3000            │
│  curl, scripts       │                │  Node.js Express API ───► Image store  │
│                      │                │           │                (Phase 3b)  │
└──────────────────────┘                │           ▼                            │
                                        │  Prisma Client                         │
                                        │           │                            │
                                        │           ▼  Compose network only      │
                                        │  PostgreSQL 17 (Docker, named volume)  │
                                        │           │                            │
                                        │           ▼  daily pg_dump             │
                                        │  Backups (local, and encrypted in B2)  │
                                        │                                        │
                                        └────────────────────────────────────────┘
```

- Requests go Express → Prisma → PostgreSQL. Nothing else talks to the database.
- Only `tailscale serve` is reachable from other devices, and only over the tailnet. The API listens on `127.0.0.1:3000`, and the database is reachable only on the Compose network (Phase 2).
- The same Express app serves the PWA's files, so the UI and the API share one HTTPS origin (F1).
- The image store arrives with images in Phase 3b. There's no Electron app: the installed PWA is the desktop app (D7).

### Component Details

#### Backend Components

1. **Node.js Express Server**: Provides the RESTful API endpoints for all application functionality
   - Processes all data operations (CRUD)
   - Validates every request with a strict schema (D1)
   - Exposes search and filtering capabilities
   - Serves the web client's files (Phase 3a), accepts image uploads (Phase 3b), and provides the offline snapshot (Phase 3c)

2. **Prisma ORM**: Manages database operations with type safety and migration support
   - Provides type-safe database access
   - Handles schema migrations
   - Enforces data validation and relationships

3. **PostgreSQL Database**: Stores all recipe data in a robust, full-featured database
   - Recipe information
   - Ingredient definitions
   - Sections and steps, tags, equipment and image metadata (Phase 3b)

4. **Image Storage System** (Phase 3b): Stores recipe images safely and efficiently
   - Files in a Docker volume on the Pi; the database holds only their metadata
   - Every upload checked and re-encoded to WebP with sharp, plus a thumbnail, with all metadata, including GPS, stripped (D11)
   - Served with long-lived caching, since a stored file never changes
   - Backed up with the database

5. **Tailscale**: Secures remote access
   - Only devices signed in to your tailnet can reach the Pi
   - Provides the HTTPS certificate the PWA needs (F1)
   - Needs no ports opened on the home router

#### Frontend Components

1. **React Application**: The only user interface
   - Clean, modern design prioritizing readability
   - Responsive from the start, phone first, since that's where recipes are read while cooking
   - Component-based architecture
   - Server data managed with TanStack Query (formerly React Query)
   - Quantities shown as fractions, from the same units module as the API (F5)

2. **Progressive Web App (PWA)**: The same app, installed
   - Installs from the browser on phone and desktop, with no app store. The main target is Firefox on Android, installed to the Home Screen
   - Opens in its own window, like a native app, which is what replaced Electron (D7)
   - Offline recipe reading from a full snapshot kept on the device with no expiry, refreshed whenever the app is online (Phase 3c; D8, D9)
   - Touch-friendly responsive controls
   - Keeps the screen on in cooking mode (Screen Wake Lock)

#### Design Philosophy
 
The UI prioritizes function over form with a clean, modern aesthetic:
 
- **Readability First**: Large, clear text especially for cooking mode
- **Easy Navigation**: Quick access to search and recent recipes
- **Mobile-Optimized**: Primary use case is viewing on phone while cooking
- **Print-Friendly**: CSS print stylesheet for physical recipe copies
 
## Integrated Development Approach

The project follows a six-phase development approach that systematically builds functionality while maintaining a focus on quality and testability. Each phase ends with working, tested software; the hardening plan in `planning/PLAN.md` tracks the detail.

### Phase 1: Foundation (Backend API) — complete

This phase established the core infrastructure, database schema and a fully functional API that can be tested from the command line, then hardened it before any real data existed. It was completed on 2 November 2026.

**Delivered:**

- **Database:**
  - PostgreSQL 17 in Docker, reachable from the development machine only, with data in a named volume
  - Recipe, Ingredient and RecipeIngredient models with UUID primary keys
  - Unique, normalised ingredient names (lowercase, trimmed)
  - Ordered ingredient lines with preparation notes, optional quantities, ranges such as "2–3", and units from a canonical list
  - Indexes for foreign keys, and trigram indexes for fuzzy search

- **API:**
  - RESTful endpoints for CRUD on recipes and ingredients, and `GET /api/health`, which checks the database
  - Strict request validation with Zod, rejecting unknown fields
  - Fuzzy, typo-tolerant search on names
  - Pagination with a stable order, and the total in an `X-Total-Count` header
  - Cascade delete for Recipe → RecipeIngredient, restrict delete for Ingredient → RecipeIngredient
  - Consistent error responses, and a CORS allowlist

- **Testing and CI:**
  - Integration tests for every endpoint with Jest and Supertest, plus unit tests: 220 tests covering 93.6% of statements
  - A separate test database, and a guard that stops the test reset from touching any other database
  - GitHub Actions running lint, type-check and tests against a real PostgreSQL on every pull request

- **Documentation:** a README, an API reference, and an ERD that matches the schema

**Success Criteria (all met):**
- All CRUD operations work correctly for recipes and ingredients
- Tests pass consistently, locally and in CI
- The API can be exercised with curl, Supertest or similar tools

### Phase 2: Pi Deployment with Tailscale HTTPS — running

This phase deploys the API to the Raspberry Pi and makes it reachable from the user's devices over Tailscale, with HTTPS from day one. Setting up HTTPS now means the network setup doesn't have to be redone for the Phase 3 PWA, which needs a secure context for its service worker, installation and wake lock (F1).

**Key Deliverables:**

- **A durable Pi (V4):**
  - 64-bit Raspberry Pi OS, booting from an SSD rather than an SD card
  - Docker Engine with the Compose plugin, and unattended security updates

- **Tailscale:**
  - The Pi on the tailnet under a bland name, because the name appears in public certificate logs as `<name>.<tailnet>.ts.net`
  - Key expiry disabled for the Pi, MagicDNS and HTTPS certificates turned on
  - `tailscale serve` providing `https://<name>.<tailnet>.ts.net`, forwarding to the API on `127.0.0.1:3000`. The same address is used everywhere, including at home, so the PWA has one origin and one offline cache

- **Containers:**
  - A production Compose file: the API published on 127.0.0.1 only, the database not published at all, healthchecks on both, and secrets from a `.env` file on the Pi
  - A multi-stage Dockerfile running as the non-root `node` user, built on the Pi

- **Operations:**
  - A deploy script that backs up first and aborts if the backup is empty, migrates with the new image, then waits for the health check to pass (T3)
  - Daily backups kept for 7 days, an encrypted copy off the Pi, and a tested restore

**Technical Focus:**
- Containerization and deployment standards
- Resource limits of the Raspberry Pi
- Reliability: everything comes back after a reboot

**Success Criteria (all met):**
- A phone on the tailnet gets a 200 from `https://<name>.<tailnet>.ts.net/api/health`
- From the home network, the Pi's port 3000 and port 5432 both refuse connections
- After a reboot, everything comes back without intervention
- A restore from backup has been tested

**Still open:** booting from the SSD (the Pi runs from its SD card until the SSD arrives).

### Phase 3: User Interface

This phase introduces the user interface, mobile-friendly from the start, since the main use is reading a recipe on a phone while cooking. It was the largest phase, so the Phase 3 gate settled its open decisions on 22 Nov 2026 and split it into three parts, each a step of its own (D10).

**Decisions (settled at the gate):**
- **D7, Electron: dropped.** The installed PWA is the desktop app (V2).
- **D8, sync: a full snapshot with an ETag.** Delta sync with tombstones only if it's ever needed (F2).
- **D9, offline: read-only.** Editing waits for a connection, so two devices can't conflict (F3).
- **D10: three parts,** below.
- **D11, image uploads:** JPEG, PNG and WebP only, up to 15 MB and 50 megapixels, re-encoded to WebP with all metadata stripped, 10 per recipe (S4).

#### Phase 3a: The UI and Cooking Mode

On the Phase 1 schema, with no new tables.

**Key Deliverables:**
- A React app served from the Pi's HTTPS address, installable as a PWA
- Recipe list with search, recipe view, create, edit and delete, and ingredient management
- Quantities shown and typed as fractions, using the same units module as the API (F5)
- Cooking mode: a switch on the recipe page that keeps the screen on, so the recipe can be read and scrolled while cooking with no extra taps
- Small, unobtrusive timers for mid-length waits, several at once if needed
- Print stylesheet
- Protection against saving over an edit made on another device (F3)
- Devices kept in step without background syncing: each refreshes when the app opens, comes back to the front or reconnects, and after its own saves, with a Refresh button for any other time

**Success Criteria:**
- Recipes can be found, read, created, edited and deleted from a phone and a laptop
- The app installs from Firefox on Android and opens from the Home Screen
- Cooking mode keeps the screen on through a whole recipe
- With the app open on both, a recipe added on the laptop appears on the phone as soon as the phone's app comes back to the front, or Refresh is tapped
- End-to-end tests cover the main flows in Firefox and Chromium, at phone and desktop sizes, in CI

#### Phase 3b: Structured Recipes, Images, Tags and Equipment

**Key Deliverables:**
- Sections and steps, with an optional timer on each step, and ingredient lines grouped by section
- Existing text instructions migrated into steps
- Image upload following D11, with a main image (a `primaryImageId` on Recipe, F7) and thumbnails
- Tags, with colours and filtering, and equipment
- Create, update and delete for every part of a recipe (F6)
- Images included in the backups

**Success Criteria:**
- A recipe with sections, steps, timers, images, tags and equipment can be created and edited from the phone
- A phone photo uploads with its GPS data removed
- A step with a timer starts it with one tap

#### Phase 3c: Offline Reading

**Key Deliverables:**
- A snapshot endpoint, and a client that keeps the snapshot on the device (D8)
- An offline copy that never expires: it's replaced only by a complete newer snapshot, and a one-tap Protect button asks the browser for persistent storage, so the copy isn't cleared to free space
- Failed refreshes retried automatically while the app is on screen, and the Refresh button to try at once
- Every recipe readable, and cooking mode usable, with no connection
- Editing disabled offline, with the age of the copy shown (D9)
- Thumbnails cached ahead of time, full images as they're viewed

**Success Criteria:**
- With the phone in airplane mode, the app opens from the Home Screen, any recipe opens, and cooking mode works
- The same holds weeks after the app was last opened, with the copy from its last refresh
- If the first refresh fails and the connection comes back later, the copy updates without restarting the app
- A recipe deleted on the laptop disappears from the phone at its next refresh

**Technical Focus:**
- An intuitive interface that works one-handed on a phone
- Efficient data loading, and offline reading that stays correct

### Phase 4: Hardening and Monitoring

Remote access moved into Phase 2, so this phase makes the running system easier to keep healthy.

**Key Deliverables:**
- Uptime and disk-space alerts
- Log rotation
- Automated dependency updates (Dependabot or Renovate), including GitHub Actions versions
- The Prisma upgrade, as its own task after reading that version's upgrade guide (V5)
- Optionally, an API check that requests come from the expected Tailscale user (S1)

**Technical Focus:**
- Noticing problems before they lose data
- Keeping dependencies current without breaking the build

**Success Criteria:**
- An alert fires when the API is down or the disk is nearly full
- Dependency updates arrive as pull requests that CI tests

### Phase 5: Mobile UI Polish

This phase refines the mobile experience. Since the React app is already responsive and installable as a PWA from Phase 3, it focuses on mobile-specific improvements.

**Key Deliverables:**

- **PWA Enhancements:**
  - Optimized PWA manifest and icons
  - Improved offline experience
  - Better touch interactions
  - Camera integration for recipe photos

- **Cooking Mode Enhancements:**
  - Voice control exploration (stretch goal)
  - An optional one-step-at-a-time view, alongside the full-recipe view
  - Wake lock improvements
  - Timer alerts while another app is open, sent as push notifications from the Pi (D14)

- **Mobile-Specific Features:**
  - Quick recipe search with recent and favourite recipes
  - Share recipes
  - Shopping list generation from recipes. This needs the shopping-list tables, which the schema places in Phase 6 (F7): bring those tables forward, or move this item to Phase 6.

**Technical Focus:**
- Mobile UX refinement
- Touch gesture optimization
- Battery and data efficiency
- Performance profiling on mobile devices

### Phase 6: Enhanced Features

The final phase adds features that turn the application from a recipe manager into a cooking companion.

**Key Deliverables:**

- **Advanced Database Schema:**
  - Meal planning, with dates stored as dates (`@db.Date`) to avoid timezone off-by-one errors, and a delete rule that doesn't make planned recipes undeletable (F7)
  - Shopping list management
  - Nutritional information
  - Recipe variations and links (components, variations, pairings)
  - Ingredient categories (produce, dairy, pantry, and so on)

- **Nutrition Data (D12, open):**
  - Recommended source: USDA FoodData Central. It's free with a data.gov key, the data is public domain, and it allows 1,000 requests an hour. The per-ingredient data it provides is also what the local nutrition calculation needs.
  - Spoonacular's terms allow caching its data for at most one hour, and require deleting it if you stop using the API, so it can't be the stored source (V1).
  - Unit conversion from volume to weight, using a density per ingredient, so nutrition and shopping lists can add quantities up (F5)

- **Spoonacular, for live extras only:**
  - Ingredient substitution recommendations and wine pairing suggestions, fetched when needed and not stored
  - Within its limits (150 points a day, 1 request a second), with the required attribution backlinks

- **Feature Development:**
  - Recipe scaling that handles eggs, spices and other ingredients that don't scale linearly, with confirmation for unusual factors
  - Meal planning calendar
  - Shopping list generator, grouped by ingredient category
  - URL recipe import (stretch goal): read the schema.org Recipe data most recipe sites embed, and block private IP ranges so the Pi can't be used to probe the home network (M5)

- **Settled at the Phase 3 gate (M1):** recipe links are built here, in Phase 6, and the Phase 3 schema no longer has them. Timers come in two steps: quick timers added while cooking, several at once (3a), and timers set on steps (3b).

**Technical Focus:**
- Complex data processing
- Integrating external data within each provider's terms and limits
- Graceful fallbacks when an external service is unavailable
 

## Continuous Integration and Deployment

### GitHub Actions Workflow

The project implements CI using GitHub Actions (`.github/workflows/node.js.yml`):

1. **Continuous Integration**
   - Runs on pull requests into `main`, and on pushes to `main` and `develop*` branches
   - Lints and type-checks, then runs every test against a real PostgreSQL 17 service, with a coverage summary on the run's page
   - From Phase 3: the web client's lint, type-check and unit tests, then end-to-end tests in Firefox and Chromium (technical spec §5.6)

2. **Deployment**
   - Manual: `scripts/deploy.sh` on the Pi backs up, pulls `main`, builds, migrates and waits for the health check (technical spec §6.2)
   - Nothing deploys on its own, so every migration runs while someone is watching
   - The database is backed up daily, with an encrypted copy in Backblaze B2

### Quality Assurance

To maintain code quality throughout development:

1. **Code Quality Standards**
   - ESLint for consistent code style
   - TypeScript in strict mode, for both the API and the web client

2. **Testing Requirements**
   - API endpoint tests for all routes
   - Database operation tests for all entities
   - Test data seeding for consistent test state
   - End-to-end tests for the main UI flows, in Firefox and Chromium, at phone and desktop sizes (Phase 3)

3. **Documentation Requirements**
   - README documentation for setup and configuration
   - API documentation
   - Database schema documentation

## Success Criteria
 
The project will be considered successful when the following criteria are met:
 
1. **Functionality Completeness**
   - All planned features through Phase 5 are implemented and working correctly
   - The application can be used to manage a growing collection of recipes
   - Recipe search and filtering works efficiently
 
2. **Technical Implementation**
   - Tests cover critical paths and pass consistently
   - Deployment to Raspberry Pi is reliable and repeatable
   - Docker containers are properly configured and maintainable
   - Database backups function automatically
 
3. **User Experience**
   - Application is responsive on both desktop and mobile devices
   - Offline functionality works reliably
   - UI is intuitive and requires minimal instruction
   - Recipe management workflow is efficient and streamlined
 
4. **System Performance**
   - API response times remain acceptable for typical operations
   - Image loading and processing completes within acceptable timeframes
   - Application startup time is reasonable
   - System resource usage on Raspberry Pi remains within sustainable limits
 
5. **Learning Objectives**
   - Development practices mirror professional standards
   - Documentation is clear and follows conventions
   - The entire system is maintainable and extensible
 
## Risk Assessment
 
### Potential Challenges
 
1. **Raspberry Pi Performance**
   - **Risk**: Limited computational resources may impact application performance
   - **Mitigation**: Optimize database queries, implement efficient image processing, monitor resource usage
 
2. **Network Reliability**
   - **Risk**: VPN connection may be unreliable in certain network conditions
   - **Mitigation**: Read-only offline use from a full snapshot (Phase 3c), a banner when offline, and a fresh snapshot as soon as the connection returns
 
3. **Data Security**
   - **Risk**: Self-hosted solution may have security vulnerabilities
   - **Mitigation**: Tailscale only, with nothing published on the home network (Phase 2); dependency updates (Phase 4); every image upload checked and re-encoded (D11)
 
4. **Scope Management**
   - **Risk**: Project scope may expand beyond manageable bounds
   - **Mitigation**: Adhere to the phased approach, and split the largest phase, Phase 3, into three parts that each end in something usable (D10)
 
5. **External API Dependencies**
   - **Risk**: Spoonacular API limits or availability could impact features
   - **Mitigation**: Store nutrition data from USDA FoodData Central (D12), use Spoonacular only for live extras that are never stored (V1), and degrade gracefully when a service is down
 
6. **Sync Complexity**
   - **Risk**: Offline sync could become complex, with conflicts between devices
   - **Mitigation**: A full snapshot instead of delta sync (D8), and read-only offline use, so there's nothing to reconcile (D9)
 
## Conclusion
 
This design document outlines a comprehensive plan for developing a personal recipe management application using modern web technologies and professional development practices. By following the six-phase approach, the project systematically builds from a functional API through deployment on the Pi with Tailscale, the user interface in three parts, hardening, mobile polish, and finally enhanced features.
 
The Raspberry Pi serves as the central hub for recipe storage, with clients keeping a read-only offline copy, refreshed from a full snapshot whenever the data has changed. Each phase builds upon the previous one, ensuring that the system evolves in a controlled and tested manner toward the complete vision.
 
