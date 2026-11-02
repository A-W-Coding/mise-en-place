/**
 * @module tests/helpers/global-setup
 * Jest `globalSetup`: runs once, before any test file.
 *
 *  1. Loads `.env.test`, overriding any DATABASE_URL already in the
 *     environment, so a shell that has `.env` loaded can't redirect the tests.
 *     In CI there is no `.env.test`, and the workflow's DATABASE_URL is used.
 *  2. Refuses to continue unless DATABASE_URL names a `_test` database.
 *  3. Applies migrations once per run, instead of once per test file.
 */

import { execSync } from 'child_process';
import dotenv from 'dotenv';

export default function globalSetup(): void {
    dotenv.config({ path: '.env.test', override: true });

    // Same rule as assertSafeDatabase(TEST_ONLY) in prisma/utils/safe-database.ts.
    // Jest loads this file outside its module mapping, so it can't import that
    // TypeScript module; the reset and seed still use the full guard.
    const url = process.env.DATABASE_URL;
    const database = url ? decodeURIComponent(new URL(url).pathname.slice(1)) : '';
    if (!database.endsWith('_test')) {
        throw new Error(
            `Refusing to run tests against database "${database}": only names ending in _test are allowed.`,
        );
    }

    console.log(`\n[global-setup] Applying migrations to ${database}`);
    execSync('npx prisma migrate deploy', {
        env: { ...process.env },
    });
}
