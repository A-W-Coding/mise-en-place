/**
 * @module prisma/seeds/run
 * Command-line entry point for the base seed.
 *
 * Run with `npm run seed` or `npx prisma db seed`. Loads `.env`, refuses
 * anything but a `_dev` or `_test` database, seeds, then disconnects.
 *
 * Kept separate from `base-seed.ts` because the test helpers import that
 * file, and code that ran on import would seed during every test run.
 */

import 'dotenv/config';
import { prisma } from '../client.js';
import { assertSafeDatabase, TEST_OR_DEV } from '../utils/safe-database.js';
import { seed } from './base-seed.js';

try {
    const database = assertSafeDatabase(TEST_OR_DEV);
    console.log(`[seed] Seeding ${database}`);
    await seed(prisma);
    console.log('[seed] Done');
} catch (error) {
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
