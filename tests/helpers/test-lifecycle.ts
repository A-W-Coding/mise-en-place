/**
 * @module tests/helpers/test-lifecycle
 * Shared test lifecycle hooks for integration tests.
 *
 * Call `setupTestLifecycle()` at the top of each `describe` block to
 * register beforeEach / afterEach / afterAll hooks that:
 *  1. Reset the database to the base seed before every test.
 *  2. Clean the database after every test.
 *  3. Disconnect Prisma after the suite completes.
 *
 * Migrations run once per test run in `global-setup.ts`, not here.
 * The reset helpers refuse to touch anything but a `_test` database.
 */

import { prisma, resetWithBaseSeed, cleanDatabase } from '../../prisma/utils/db-utils.js';

/**
 * Register standard integration-test lifecycle hooks.
 * Must be called inside a Jest `describe()` block.
 */
export function setupTestLifecycle(): void {
    beforeEach(async () => {
        await resetWithBaseSeed();
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });
}
