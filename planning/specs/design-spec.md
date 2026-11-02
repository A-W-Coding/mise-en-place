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
 
The Recipe App adopts a modern architecture utilizing Node.js, React, and Electron, with data persistence handled by Prisma and PostgreSQL.
 
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
│                      │                │           │                (Phase 3)   │
└──────────────────────┘                │           ▼                            │
                                        │  Prisma Client                         │
                                        │           │                            │
                                        │           ▼  Compose network only      │
                                        │  PostgreSQL 17 (Docker, named volume)  │
                                        │           │                            │
                                        │           ▼  daily pg_dump             │
                                        │  Backups (SSD, encrypted copy off-Pi)  │
                                        │                                        │
                                        └────────────────────────────────────────┘
```

- Requests go Express → Prisma → PostgreSQL. Nothing else talks to the database.
- Only `tailscale serve` is reachable from other devices, and only over the tailnet. The API listens on `127.0.0.1:3000`, and the database is reachable only on the Compose network (Phase 2).
- The image store arrives with images in Phase 3. Electron isn't shown: D7 recommends dropping or deferring it in favour of the installed PWA.
 
### Component Details
 
#### Backend Components
 
1. **Node.js Express Server**: Provides the RESTful API endpoints for all application functionality
   - Processes all data operations (CRUD)
   - Manages image uploads and processing
   - Exposes search and filtering capabilities
 
2. **Prisma ORM**: Manages database operations with type safety and migration support
   - Provides type-safe database access
   - Handles schema migrations
   - Enforces data validation and relationships
 
3. **PostgreSQL Database**: Stores all recipe data in a robust, full-featured database
   - Recipe information
   - Ingredient definitions
   - Tags and categories (future phase)
   - Instruction steps (future phase)
   - Image metadata (future phase)
 
4. **Image Storage System**: Manages recipe images with efficient storage (Phase 3)
   - Images stored on Pi filesystem, paths stored in database
   - Image compression and optimization
   - Thumbnail generation
   - Serves images to clients via API
 
5. **VPN Solution**: Secures remote access to the system
   - Enables secure connections from external networks
   - Provides encrypted data transmission
   - Simplifies network configuration
 
#### Frontend Components
 
1. **React Application**: Core user interface built with React
   - Clean, modern design prioritizing readability
   - Responsive design for all screen sizes (mobile-friendly from Phase 3)
   - Component-based architecture
   - State management with React Query
   - Offline data caching with timestamp-based sync
 
2. **Electron Wrapper**: Packages the React application for desktop use
   - Native desktop experience
   - Offline capability
   - System integration (notifications, etc.)
 
3. **Progressive Web App (PWA)**: Same React codebase, installable on mobile
   - Install via "Add to Home Screen" in browser
   - No app store required
   - Offline recipe viewing
   - Single codebase for web, desktop, and mobile
   - Touch-friendly responsive controls
 
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

### Phase 2: Pi Deployment with Tailscale HTTPS — next

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

**Success Criteria:**
- A phone on the tailnet gets a 200 from `https://<name>.<tailnet>.ts.net/api/health`
- From the home network, the Pi's port 3000 and port 5432 both refuse connections
- After a reboot, everything comes back without intervention
- A restore from backup has been tested

### Phase 3: User Interface

This phase introduces the user interface, mobile-friendly from the start, since the main use is reading a recipe on a phone while cooking. It is the largest phase, so it starts with a gate: decisions D7–D11 are settled and the Phase 3 spec segments are written before any UI code.

**Decisions at the gate (open; recommendations from the design review):**
- **D7, Electron:** recommended to drop or defer it. An installed PWA already gives a desktop window with offline support, from one codebase (V2).
- **D8, sync design:** recommended to start with a full snapshot plus an ETag, and add delta sync with tombstones only if needed. Timestamp-based delta sync misses child edits and deletes (F2).
- **D9, offline editing:** recommended read-only offline at first, to avoid edit conflicts between devices (F3).
- **D10, splitting the phase:** recommended to split it in three (V3):
  - **3a:** the UI and cooking mode, on the Phase 1 schema
  - **3b:** structured instructions and sections, images, tags and equipment
  - **3c:** offline support
- **D11, image uploads:** allowed types, size and pixel limits, and re-encoding (S4).

**Key Deliverables:**

- **Frontend:**
  - React application with recipe viewing and editing
  - Responsive design, installable as a PWA over the Phase 2 HTTPS address
  - Quantities shown as fractions, using the same units module as the API (F5)
  - Print stylesheet

- **Cooking Mode:**
  - Large, readable text and a step-by-step view
  - Screen kept awake (Screen Wake Lock)
  - Basic timer

- **Expanded Schema and API:**
  - Structured instructions and recipe sections, including a section link on ingredient lines
  - Image upload and storage, with a `primaryImageId` on Recipe rather than an `isPrimary` flag on images (F7)
  - Tags and equipment, and the endpoints the original plan lacked: instruction CRUD, attaching tags and equipment to recipes, and deletes for sections, links and equipment (F6)

- **Offline:** read-only offline caching of recipes, using the sync design chosen in D8

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
  - Multiple concurrent timers
  - Improved step navigation
  - Wake lock improvements

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
  - Cooking timer implementation
  - Meal planning calendar
  - Shopping list generator, grouped by ingredient category
  - URL recipe import (stretch goal): read the schema.org Recipe data most recipe sites embed, and block private IP ranges so the Pi can't be used to probe the home network (M5)

- **Still to resolve:** recipe links appear in both Phase 3 (technical spec) and Phase 6 (this document), and timers in Phases 3, 5 and 6 (M1). Settle each one's phase at the Phase 3 gate.

**Technical Focus:**
- Complex data processing
- Integrating external data within each provider's terms and limits
- Graceful fallbacks when an external service is unavailable
 
## Continuous Integration and Deployment
 
### GitHub Actions Workflow
 
The project implements CI using GitHub Actions:
 
1. **Continuous Integration**
   - Triggered on every push and pull request
   - Runs linting checks to enforce code style
   - Executes all unit and integration tests
   - Generates test coverage reports
 
2. **Deployment**
   - Manual deployment from local development environment
   - Deployment scripts ensure consistent process
   - Database backup before each deployment
 
### Quality Assurance
 
To maintain code quality throughout development:
 
1. **Code Quality Standards**
   - ESLint configuration for consistent code style
   - Prettier for automatic code formatting
   - TypeScript for type safety
 
2. **Testing Requirements**
   - API endpoint tests for all routes
   - Database operation tests for all entities
   - Test data seeding for consistent test state
 
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
   - **Mitigation**: Implement robust offline capabilities, add connection status indicators, create retry mechanisms
 
3. **Data Security**
   - **Risk**: Self-hosted solution may have security vulnerabilities
   - **Mitigation**: Use established VPN solutions (Tailscale), keep dependencies updated, follow security best practices
 
4. **Scope Management**
   - **Risk**: Project scope may expand beyond manageable bounds
   - **Mitigation**: Adhere to phased development approach, prioritize features, maintain focus on core functionality
 
5. **External API Dependencies**
   - **Risk**: Spoonacular API limits or availability could impact features
   - **Mitigation**: Implement long-term caching, local calculation fallbacks, graceful degradation
 
6. **Sync Complexity**
   - **Risk**: Offline sync could become complex with conflict resolution
   - **Mitigation**: Start with simple timestamp-based sync, single-user model avoids most conflicts
 
## Conclusion
 
This design document outlines a comprehensive plan for developing a personal recipe management application using modern web technologies and professional development practices. By following the six-phase approach, the project systematically builds from a functional API through local deployment, UI development, global access, mobile support, and finally enhanced features.
 
The Raspberry Pi serves as the central hub for recipe storage, with clients maintaining offline copies that sync efficiently using timestamp-based change detection. Each phase builds upon the previous one, ensuring that the system evolves in a controlled and tested manner toward the complete vision.
 