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
┌─────────────────────────────────────┐     ┌─────────────────────────────┐
│         Raspberry Pi Server         │     │       Client Devices        │
│                                     │     │                             │
│  ┌─────────────┐    ┌────────────┐  │     │  ┌──────────────────────┐  │
│  │             │    │            │  │     │  │                      │  │
│  │  Node.js    │    │ PostgreSQL │  │     │  │  Electron App        │  │
│  │  Express    │◄───┤  Database  │  │     │  │  (Desktop)           │  │
│  │  API Server │    │            │  │     │  │                      │  │
│  │             │    └────────────┘  │     │  └──────────────────────┘  │
│  └──────┬──────┘         ▲          │     │                             │
│         │                │          │     │  ┌──────────────────────┐  │
│         │                │          │     │  │                      │  │
│  ┌──────▼──────┐  ┌──────┴───────┐  │     │  │  Progressive Web App │  │
│  │             │  │              │  │     │  │  (Mobile)            │  │
│  │  Prisma ORM │  │ Image Store  │  │     │  │                      │  │
│  │             │  │ (Filesystem) │  │     │  └──────────────────────┘  │
│  └─────────────┘  └──────────────┘  │     │                             │
│                                     │     │                             │
└──────────────────┬──────────────────┘     └──────────────┬──────────────┘
                   │                                       │
                   │         VPN Tunnel (Tailscale)        │
                   └───────────────────────────────────────┘
```
 
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
 
The project follows a six-phase development approach that systematically builds functionality while maintaining a focus on quality and testability.
 
### Phase 1: Foundation (Backend API)
 
This initial phase establishes the core infrastructure, database schema, and a fully functional API that can be tested via command line tools.
 
**Key Deliverables:**
 
- **Database Implementation:**
  - PostgreSQL database running in Docker
  - Core schema with Recipe, Ingredient, and RecipeIngredient models
  - UUID-based primary key strategy
  - Normalized ingredient names (lowercase, trimmed)
 
- **API Development:**
  - RESTful endpoints for CRUD operations on recipes and ingredients
  - Search functionality (exact matching initially, partial/fuzzy matching added later in phase)
  - Request validation and error handling
  - Cascade delete for Recipe → RecipeIngredient relationships
  - Restrict delete for Ingredient → RecipeIngredient relationships
 
- **Testing Framework:**
  - Unit tests for database operations
  - Integration tests for API endpoints using Jest and Supertest
  - Test data generation utilities with database seeding
 
**Technical Focus:**
- Establishing proper development environment
- Implementing test-driven development practices
- Creating a robust foundation for subsequent phases
- Ensuring the API is fully functional and testable from the command line
 
**Success Criteria:**
- All CRUD operations work correctly for recipes and ingredients
- Tests pass consistently
- API can be exercised via curl, Supertest, or similar tools
 
### Phase 2: Pi Deployment (Local Network)
 
This phase focuses on deploying the application to the Raspberry Pi and making it accessible across the local network.
 
**Key Deliverables:**
 
- **Infrastructure Setup:**
  - Docker containerization of backend services
  - PostgreSQL running on Raspberry Pi
  - Deployment scripts for consistent deployments
  - Backup strategy implementation
 
- **Local Network Access:**
  - API accessible from other devices on the same LAN
  - Basic health monitoring
  - Service auto-restart on failure
 
**Technical Focus:**
- Containerization and deployment standards
- Resource optimization for Raspberry Pi constraints
- Reliable local network operation
 
**Success Criteria:**
- Application runs stably on Raspberry Pi
- Can create and retrieve recipes from another device on the LAN
- Automated backups are functioning
 
### Phase 3: Desktop UI
 
This phase introduces the user interface, with mobile responsiveness built in from the start since the primary use case is viewing recipes on phone while cooking.
 
**Key Deliverables:**
 
- **Expanded Database Schema:**
  - Structured instructions and recipe sections
  - Image metadata storage
  - Equipment and tag management
 
- **Enhanced API Development:**
  - Image upload and processing endpoints
  - Advanced search and filtering options
  - Tag and category management
 
- **Frontend Implementation:**
  - React application with core components
  - Recipe viewing and editing interfaces
  - Image management
  - Responsive design (mobile-friendly from day one)
  - Electron packaging for desktop use
  - Offline data caching
  - Print stylesheet for recipe printing
 
- **Cooking Mode (Foundation):**
  - Large, readable text
  - Step-by-step instruction view
  - Screen stays awake during cooking
  - Basic timer functionality
 
- **Sync Strategy:**
  - Timestamp-based synchronization using `updatedAt` fields
  - Client stores last sync timestamp
  - Server returns only changed records since last sync
  - Efficient delta updates rather than full data transfers
 
**Technical Focus:**
- Creating an intuitive user interface
- Implementing responsive design practices
- Setting up efficient data communication
- Ensuring offline functionality with smart sync
 
### Phase 4: Pi Deployment (Global Access)
 
This phase extends the Pi deployment to allow secure access from outside the local network.
 
**Key Deliverables:**
 
- **Remote Access Setup:**
  - VPN configuration (Tailscale or similar)
  - Secure connection from external networks
  - Mobile device connectivity testing
 
- **Security & Reliability:**
  - System health monitoring
  - Error handling and recovery
  - Data integrity validation
 
**Technical Focus:**
- Secure remote access implementation
- Performance optimization over VPN connections
- Resilience testing
 
**Success Criteria:**
- Application accessible securely from outside home network
- Performance remains acceptable over VPN
- Basic mobile browser access works
 
### Phase 5: Mobile UI Polish
 
This phase refines the mobile experience. Since the React app is already responsive and installable as a PWA from Phase 3, this phase focuses on mobile-specific optimizations.
 
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
  - Quick recipe search with recent/favorites
  - Shopping list generation from recipes
  - Share recipes functionality
 
**Technical Focus:**
- Mobile UX refinement
- Touch gesture optimization
- Battery and data efficiency
- Performance profiling on mobile devices
 
### Phase 6: Enhanced Features
 
The final phase adds advanced features that transform the application from a basic recipe manager to a comprehensive cooking companion.
 
**Key Deliverables:**
 
- **Advanced Database Schema:**
  - Meal planning and calendar models
  - Shopping list management
  - Nutritional information tracking
  - Recipe variations
  - Recipe linking (components, variations, pairings)
  - Ingredient categories/tags (produce, dairy, pantry, etc.)
 
- **External API Integration (Spoonacular):**
  - Recipe information lookup
  - Nutritional information calculation
  - Ingredient substitution recommendations
  - Wine pairing suggestions
  - Long-term caching strategy (nutritional data is stable)
  - Required attribution backlinks
 
- **Feature Development:**
  - Recipe scaling interface (intelligent scaling, not just multiplication)
  - Cooking timer implementation
  - Meal planning calendar
  - Shopping list generator (organized by ingredient category)
  - URL recipe import (stretch goal - scrape recipes from websites)
 
- **Recipe Scaling Considerations:**
  - Simple multiplication for most ingredients
  - Intelligent handling for eggs, spices, and items that don't scale linearly
  - User confirmation for unusual scaling factors
 
**Spoonacular API Integration Strategy:**
 
For nutritional information and recipe analysis, the application will integrate with the Spoonacular API:
 
1. **API Usage Constraints**
   - Hard limit of 150 points per day
   - Rate limit of 1 request per second
   - Backlink attribution requirement
 
2. **Long-Term Data Persistence**
   - Store complete API responses with long expiration periods (90-180 days)
   - Refresh only when recipe ingredients change or user explicitly requests
   - Nutritional data is fundamentally stable and rarely needs updating
 
3. **Resilience Architecture**
   - Local calculation fallback for basic nutritional values
   - Clear visual indicators of data source (API vs. calculated)
   - Graceful degradation when API limits are reached
 
**Technical Focus:**
- Implementing complex data processing
- Integrating with external systems within API limits
- Building resilient systems with graceful fallbacks
- Enhancing user experience with advanced features
 
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
 