/**
 * @module prisma/utils/db-utils
 * Database lifecycle helpers used by tests and seed scripts.
 *
 * Provides functions to wipe the database, re-seed it from the base seed,
 * or apply an arbitrary seed module. All operations respect foreign-key
 * ordering (junction tables first, then parent tables).
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '../client.js';
import { assertSafeDatabase, TEST_ONLY } from './safe-database.js';

/** Shape every seed module must satisfy. */
interface SeedModule {
    seed: (prisma: PrismaClient) => Promise<void>;
}

/**
 * Delete all rows from every table in foreign-key-safe order.
 * RecipeIngredient → Recipe → Ingredient.
 *
 * Refuses to run unless DATABASE_URL names a `_test` database.
 *
 * @throws If the database isn't a `_test` database, before deleting anything.
 * @throws Re-throws any Prisma error after logging.
 */
export async function cleanDatabase(): Promise<void> {
    assertSafeDatabase(TEST_ONLY);
    try {
        await prisma.recipeIngredient.deleteMany({});
        await prisma.recipe.deleteMany({});
        await prisma.ingredient.deleteMany({});
    } catch (error) {
        console.error('[cleanDatabase] Failed:', error);
        throw error;
    }
}

/**
 * Wipe the database then apply the base seed.
 * This is the standard "reset to known state" used before each test.
 *
 * @throws Re-throws any Prisma or seed error after logging.
 */
export async function resetWithBaseSeed(): Promise<void> {
    try {
        await cleanDatabase();
        const baseSeed = await import('../seeds/base-seed.js');
        await baseSeed.seed(prisma);
    } catch (error) {
        console.error('[resetWithBaseSeed] Failed:', error);
        throw error;
    }
}

/**
 * Apply an arbitrary seed module against the shared Prisma client.
 *
 * @param seedModule - Any module exporting `seed(prisma): Promise<void>`.
 */
export async function applySeed(seedModule: SeedModule): Promise<void> {
    await seedModule.seed(prisma);
}

export { prisma };
