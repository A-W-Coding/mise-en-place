# Recipe App Technical Specification
 
## 1. Introduction
 
This technical specification details the implementation approach for the Recipe App, with a particular focus on the database schema, API design, testing strategy, and deployment pipeline. The document is structured to support a six-phase development approach, allowing for incremental implementation while maintaining focus on professional development practices.
 
## 2. Database Schema Design
 
The database schema will evolve through six distinct phases, each building upon the previous one to add functionality while maintaining backward compatibility.
 
### 2.1 Phase 1: Foundation (Backend API)
 
#### Core Entities
 
The Phase 1 schema focuses on establishing the fundamental data model required for basic recipe management.
 
##### Recipe Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for recipe |
| name | String | Required | Recipe name |
| description | String | Optional | Recipe description |
| servings | Integer | Default: 1 | Number of servings recipe produces |
| prepTime | Integer | Optional | Preparation time in minutes |
| cookTime | Integer | Optional | Cooking time in minutes |
| instructions | Text | Optional | Simple text-based instructions for MVP |
| createdAt | DateTime | Auto: current time | When recipe was created |
| updatedAt | DateTime | Auto: update | When recipe was last updated |
 
##### Ingredient Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for ingredient |
| name | String | Required | Ingredient name (stored normalized/lowercase) |
 
*Note: The `name` field is normalized on input (converted to lowercase, trimmed) by the API. This eliminates the need for a separate `normalizedName` field while ensuring consistent search behavior.*
 
##### RecipeIngredient Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for recipe-ingredient relation |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| ingredientId | UUID | Foreign Key, Required | References Ingredient |
| quantity | Float | Default: 0 | Amount of ingredient |
| unit | String | Required | Unit of measurement as free text (e.g., "grams", "cups") |
 
*Note: Unit is stored as free text. Unit conversions will be handled by the UI layer in later phases.*
 
#### Phase 1 Entity Relationships
 
| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | RecipeIngredient | Ingredients used in recipe |
| Ingredient | One-to-Many | RecipeIngredient | Recipes using this ingredient |
| RecipeIngredient | Many-to-One | Recipe | Parent recipe |
| RecipeIngredient | Many-to-One | Ingredient | Referenced ingredient |
 
#### Phase 1 Schema Design Principles
 
1. **UUID Primary Keys**
   
   **Implementation:**
   ```prisma
   model Recipe {
     id        String   @id @default(uuid())
     name      String
     // other fields
   }
   ```
   
   **Rationale:** UUID primary keys were selected over auto-incrementing integers for several compelling reasons:
   - They prevent synchronization conflicts in distributed environments
   - They enable offline-first functionality, allowing recipe creation across devices without ID collisions
   - They enhance security by making IDs non-sequential and harder to guess
   - They maintain stable references when syncing or migrating data between environments
 
2. **Normalized Ingredient Names**
   
   **Implementation:**
   ```prisma
   model Ingredient {
     id   String @id @default(uuid())
     name String
     // Normalization happens at API layer, not database layer
   }
   ```
   
   **API Normalization:**
   ```typescript
   // In ingredient creation/update handlers
   name: name.toLowerCase().trim()
   ```
   
   **Rationale:** Rather than maintaining a separate `normalizedName` field, normalization is applied at the API layer:
   - Reduces schema complexity
   - Single source of truth for ingredient names
   - PostgreSQL handles case-insensitive searching efficiently
   - Normalization logic is centralized in the API
 
3. **Cascade Delete Configuration**
   
   **Implementation:**
   ```prisma
   model RecipeIngredient {
     id           String     @id @default(uuid())
     recipeId     String
     ingredientId String
     quantity     Float      @default(0)
     unit         String
 
     recipe       Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)
     ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Restrict)
   }
   ```
   
   **Rationale:** The cascade delete strategy maintains data integrity:
   - **Recipe → RecipeIngredient: Cascade** - When a recipe is deleted, its ingredient associations are automatically removed. RecipeIngredient records have no meaning without their parent recipe.
   - **Ingredient → RecipeIngredient: Restrict** - Attempting to delete an ingredient that is used in recipes will fail with an error. This prevents accidental data loss and prompts the user to handle the dependency explicitly.
   
   This approach protects shared reference data (ingredients) while allowing clean deletion of recipe-specific data.
 
4. **Deferred Features**
   
   The following features are documented but deferred beyond MVP:
   - **Soft Delete** (`deletedAt` field): Will be implemented when recipe restoration is needed
   - **Version Tracking** (`previousVersion` field): Will be implemented when undo/history is needed
   - **Measurement Conversion**: Unit conversions handled by UI, not database
 
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
  id                String             @id @default(uuid())
  name              String
  description       String?
  servings          Int                @default(1)
  prepTime          Int?
  cookTime          Int?
  instructions      String?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  recipeIngredients RecipeIngredient[]
}
 
model RecipeIngredient {
  id           String     @id @default(uuid())
  recipeId     String
  ingredientId String
  quantity     Float      @default(0)
  unit         String
 
  recipe       Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Restrict)
}
 
model Ingredient {
  id                String             @id @default(uuid())
  name              String
  recipeIngredients RecipeIngredient[]
}
```
 
### 2.2 Phase 2: Pi Deployment (Local Network)
 
Phase 2 focuses on deployment rather than schema changes. The Phase 1 schema is deployed to the Raspberry Pi with PostgreSQL running in Docker.
 
**Infrastructure Focus:**
- Docker containerization
- PostgreSQL on Raspberry Pi
- Backup automation
- Health monitoring
 
No schema changes in this phase.
 
### 2.3 Phase 3: Desktop UI
 
Phase 3 expands the schema to support the desktop user interface with structured instructions, images, tags, and equipment.
 
#### Additional Entities
 
##### RecipeSection Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for section |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| name | String | Required | Section name (e.g., "Sauce", "Main") |
| orderIndex | Integer | Required | Position within recipe |
 
##### Instruction Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for instruction |
| sectionId | UUID | Foreign Key, Required | References RecipeSection |
| stepNumber | Integer | Required | Order within section |
| text | Text | Required | Instruction text |
| stepType | String | Default: "Cooking" | Type of instruction step |
| timerLength | Integer | Optional | Timer duration in seconds |
 
##### Image Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for image |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| filePath | String | Required | Path to image file |
| isPrimary | Boolean | Default: false | Whether this is the main image |
| width | Integer | Optional | Image width in pixels |
| height | Integer | Optional | Image height in pixels |
| fileSize | Integer | Optional | File size in bytes |
| uploadedAt | DateTime | Auto: current time | When image was uploaded |
 
##### Tag Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for tag |
| name | String | Unique, Required | Tag name |
| color | String | Optional | HEX color code for visual representation |
 
##### Equipment Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for equipment |
| name | String | Unique, Required | Equipment name |
| description | Text | Optional | Equipment description |
 
##### RecipeEquipment Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for recipe-equipment relation |
| recipeId | UUID | Foreign Key, Required | References Recipe |
| equipmentId | UUID | Foreign Key, Required | References Equipment |
| optional | Boolean | Default: false | Whether equipment is optional |
| quantity | Integer | Default: 1 | Number of equipment items needed |
 
##### RecipeLink Entity
 
| Field Name | Data Type | Constraints | Description |
|------------|-----------|-------------|-------------|
| id | UUID | Primary Key | Unique identifier for recipe link |
| sourceRecipeId | UUID | Foreign Key, Required | References source Recipe |
| linkedRecipeId | UUID | Foreign Key, Required | References linked Recipe |
| linkType | String | Required | Relationship type (e.g., "component", "variation") |
| notes | Text | Optional | Notes about the recipe link |
 
#### Phase 3 Entity Relationships
 
| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | RecipeSection | Sections within recipe |
| Recipe | One-to-Many | Image | Images of recipe |
| Recipe | Many-to-Many | Tag | Tags applied to recipe |
| Recipe | One-to-Many | RecipeEquipment | Equipment used in recipe |
| Recipe | One-to-Many | RecipeLink (as source) | Links to other recipes |
| Recipe | One-to-Many | RecipeLink (as linked) | Links from other recipes |
| RecipeSection | One-to-Many | Instruction | Instructions within section |
| Tag | Many-to-Many | Recipe | Recipes with this tag |
| Equipment | One-to-Many | RecipeEquipment | Recipes using this equipment |
 
#### Phase 3 Schema Enhancements
 
1. **Structured Instructions**
   - Replace simple text instructions with hierarchical sections and steps
   - Support timing information and instruction types
   - Allow more complex recipe organization
 
2. **Image Management**
   - Store image metadata in the database
   - Support multiple images per recipe with primary image designation
   - Track image dimensions and file size for optimization
 
3. **Tagging System**
   - Implement flexible categorization through tags
   - Support colored tags for visual organization
   - Allow filtering and searching by tags
 
### 2.4 Phase 4: Pi Deployment (Global Access)
 
Phase 4 focuses on remote access rather than schema changes.
 
**Infrastructure Focus:**
- VPN configuration (Tailscale or similar)
- Security hardening
- Performance optimization for remote access
 
No schema changes in this phase.
 
### 2.5 Phase 5: Mobile UI
 
Phase 5 may introduce minor schema additions to support mobile-specific features.
 
**Potential Additions:**
- User preferences for display settings
- Offline sync metadata
- Push notification tokens
 
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
 
#### Phase 6 Entity Relationships
 
| Entity | Relationship | Related Entity | Description |
|--------|--------------|----------------|-------------|
| Recipe | One-to-Many | MealPlanEntry | Meal plan entries using this recipe |
| Recipe | One-to-One | NutritionalInfo | Nutritional information for recipe |
| MealPlan | One-to-Many | MealPlanEntry | Entries in this meal plan |
| ShoppingList | One-to-Many | ShoppingListItem | Items in this shopping list |
| Ingredient | One-to-Many | ShoppingListItem | Shopping list items referencing this ingredient |
 
## 3. API Architecture
 
The API follows RESTful principles and is implemented using Express.js with TypeScript.
 
### 3.1 API Design Principles
 
1. **Consistency**
   - Use consistent URL patterns, HTTP methods, and response formats
   - Follow RESTful naming conventions
   - Standardize error handling and response codes
 
2. **Simplicity**
   - No API versioning (single-user application)
   - Straightforward endpoint structure
   - Query parameters for filtering and searching
 
3. **Performance**
   - Support pagination for list endpoints
   - Implement filtering and sorting options
   - Efficient database queries with Prisma
 
4. **Search Strategy**
   
   **Implementation:**
   ```
   GET /api/recipes?search=pasta
   GET /api/ingredients?search=onion
   ```
   
   **Rationale:** A unified search parameter approach keeps the API simple:
   - Single `search` query parameter handles text matching
   - Server determines appropriate fields to search based on entity
   - Extensible to add more specific filters as needed (e.g., `?tag=italian`)
 
### 3.2 API Endpoints by Phase
 
#### Phase 1: Foundation
 
| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Health | GET | `/api/health` | System health check |
| Recipes | GET | `/api/recipes` | List all recipes with optional search |
| Recipes | GET | `/api/recipes/:id` | Get a specific recipe with ingredients |
| Recipes | POST | `/api/recipes` | Create a new recipe |
| Recipes | PATCH | `/api/recipes/:id` | Update a recipe |
| Recipes | DELETE | `/api/recipes/:id` | Delete a recipe (cascades to RecipeIngredients) |
| Ingredients | GET | `/api/ingredients` | List all ingredients with optional search |
| Ingredients | GET | `/api/ingredients/:id` | Get a specific ingredient |
| Ingredients | POST | `/api/ingredients` | Create a new ingredient (name normalized) |
| Ingredients | PATCH | `/api/ingredients/:id` | Update an ingredient |
| Ingredients | DELETE | `/api/ingredients/:id` | Delete an ingredient (restricted if in use) |
 
#### Phase 3: Desktop UI
 
| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Images | POST | `/api/recipes/:id/images` | Upload an image for a recipe |
| Images | GET | `/api/recipes/:id/images` | Get all images for a recipe |
| Images | DELETE | `/api/images/:id` | Delete an image |
| Images | PATCH | `/api/images/:id/primary` | Set image as primary |
| Tags | GET | `/api/tags` | List all tags |
| Tags | POST | `/api/tags` | Create a new tag |
| Tags | PATCH | `/api/tags/:id` | Update a tag |
| Tags | DELETE | `/api/tags/:id` | Delete a tag |
| Sections | GET | `/api/recipes/:id/sections` | Get all sections with instructions |
| Sections | POST | `/api/recipes/:id/sections` | Add a section to a recipe |
| Sections | PATCH | `/api/sections/:id` | Update a section |
| Equipment | GET | `/api/equipment` | List all equipment |
| Equipment | POST | `/api/equipment` | Create equipment |
| Recipe Links | GET | `/api/recipes/:id/links` | Get linked recipes |
| Recipe Links | POST | `/api/recipes/:id/links` | Create link between recipes |
| Sync | GET | `/api/sync?since=:timestamp` | Get changes since timestamp |
 
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
 
### 3.3 Sync Strategy
 
For offline-capable clients, the API supports timestamp-based synchronization:
 
**Endpoint:** `GET /api/sync?since=:timestamp`
 
**Response:**
```json
{
  "syncedAt": "2025-05-29T12:00:00Z",
  "recipes": {
    "updated": [...],
    "deleted": []
  },
  "ingredients": {
    "updated": [...],
    "deleted": []
  }
}
```
 
**Implementation Notes:**
- Returns all records where `updatedAt > since`
- Client stores `syncedAt` from response for next sync
- Deleted IDs returned when soft delete is implemented
- Single-user model avoids conflict resolution complexity
 
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
 
The project follows a test-driven development approach using Jest and Supertest.
 
### 5.1 Unit Testing
 
Unit tests focus on isolated components and functions:
 
1. **Testing Scope**
   - Database operations through Prisma
   - Data validation and transformation utilities
   - Business logic services
   - API request handlers
 
2. **Testing Approach**
   - Use Jest as the testing framework
   - Test database with seeded data
   - Test both success and failure cases
 
### 5.2 Integration Testing
 
Integration tests verify API endpoints:
 
1. **Testing Scope**
   - API endpoint functionality
   - Database interactions
   - Request validation
   - Error handling
 
2. **Testing Approach**
   - Use Supertest with Express for API testing
   - Reset database with seed data before each test
   - Test complete request-response cycles
   - Verify proper error responses
 
### 5.3 Database Seeding
 
**Implementation:**
```typescript
// prisma/seeds/base-seed.ts
export async function seed(prisma: PrismaClient) {
  // Clear existing data
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.ingredient.deleteMany();
  
  // Create test ingredients
  // Create test recipes
  // Create test recipe-ingredient links
}
```
 
**Rationale:**
- Ensures consistent test data across all environments
- Enables testing of relationships and edge cases
- Supports CI/CD with known data state
- Facilitates local development
 
### 5.4 Testing Framework Integration
 
**Implementation:**
```json
{
  "scripts": {
    "test": "cross-env NODE_OPTIONS=--experimental-vm-modules jest",
    "seed": "tsx prisma/seeds/base-seed.ts"
  }
}
```
 
**Test Setup:**
```typescript
// jest-setup.ts
beforeAll(async () => {
  execSync('npx prisma migrate deploy');
});
 
beforeEach(async () => {
  await resetWithBaseSeed();
});
 
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});
```
 
### 5.5 End-to-End Testing (Phase 3+)
 
End-to-End tests will be added when the UI is implemented:
 
1. **Testing Scope**
   - User workflows (creating and managing recipes)
   - Cross-component interactions
   - UI functionality with API communication
 
2. **Testing Approach**
   - Use Cypress or Playwright for browser-based testing
   - Implement realistic test scenarios
   - Test across different screen sizes
   - Verify offline functionality
 
## 6. Deployment Architecture
 
### 6.1 Phase 1: Local Development
 
**Docker Compose Configuration:**
```yaml
version: '3.8'
services:
  db:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - '5432:5432'
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
```
 
**Development Workflow:**
1. Start PostgreSQL: `docker-compose up -d`
2. Run migrations: `npx prisma migrate dev`
3. Start server: `npm run dev`
4. Run tests: `npm test`
 
### 6.2 Phase 2: Pi Deployment (Local)
 
**Infrastructure:**
- Docker on Raspberry Pi
- PostgreSQL container
- Node.js API container
- Persistent volumes for data
 
**Deployment Script:**
```bash
#!/bin/bash
# Deploy to Raspberry Pi
 
# Create backup
docker exec recipe-db pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
 
# Pull latest code
git pull origin main
 
# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
 
# Run migrations
docker exec recipe-api npx prisma migrate deploy
 
# Verify health
curl http://localhost:3000/api/health
```
 
**Backup Strategy:**
- Automated daily backups via cron
- Backup rotation (keep last 7 days)
- Store backups on separate storage
 
### 6.3 Phase 4: Global Access
 
**VPN Configuration:**
- Tailscale or similar mesh VPN
- No port forwarding required
- Automatic key management
- Mobile device support
 
**Security Considerations:**
- VPN-only access (no public exposure)
- Database credentials in environment variables
- Regular dependency updates
 
### 6.4 Continuous Integration
 
**GitHub Actions Workflow:**
```yaml
name: CI
on: [push, pull_request]
 
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: recipe_test
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm test
```
 
**CI Strategy:**
- Automated testing on push/PR
- Manual deployment from local environment
- Avoids exposing home network for CI/CD
 
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
 
#### Phase 1 to Phase 3: Instruction Structure Transformation
 
The migration from simple text instructions to structured sections and steps:
 
1. Create RecipeSection and Instruction tables
2. For each recipe with text instructions:
   - Create a default section named "Instructions"
   - Parse text into individual steps (split by newlines or numbered items)
   - Create Instruction records with proper ordering
3. Optionally retain original `instructions` field for reference
4. Validate transformation results
 
#### Adding Soft Delete (Future)
 
When implementing soft delete:
 
1. Add `deletedAt` column to Recipe table
2. Update all queries to filter `WHERE deletedAt IS NULL`
3. Modify DELETE endpoints to set `deletedAt` instead of removing
4. Create cleanup job for permanent deletion after retention period
 
## 8. Conclusion
 
This technical specification outlines the implementation plan for the Recipe App across six development phases. The approach prioritizes:
 
1. **Working Software First** - Phase 1 delivers a complete, testable API
2. **Incremental Deployment** - Pi deployment in Phase 2 establishes the production environment early
3. **User Interface** - Phases 3 and 5 add desktop and mobile interfaces
4. **Global Access** - Phase 4 enables secure remote access
5. **Enhanced Features** - Phase 6 adds advanced functionality
 
The schema evolves to support each phase's requirements while maintaining backward compatibility. Testing ensures reliability at each stage, and the deployment strategy balances automation with simplicity appropriate for a personal project.
 
Each phase builds upon the previous one, with clear migration paths to ensure the application remains functional and efficient as it grows in complexity.