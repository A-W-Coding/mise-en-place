/**
 * @module tests/safe-database.test
 * Tests for the database guard that protects the test reset and the seed.
 *
 * The unit tests pass the environment in directly, so they never depend on
 * the real DATABASE_URL. The last test checks the real reset helper: pointed
 * at a non-test database, it must throw before deleting anything.
 */

import { assertSafeDatabase, TEST_ONLY, TEST_OR_DEV } from '../prisma/utils/safe-database.js';
import { prisma, cleanDatabase, resetWithBaseSeed } from '../prisma/utils/db-utils.js';

const SERVER = 'postgresql://user:s3cret@localhost:5432';

describe('assertSafeDatabase', () => {
    describe('test reset (TEST_ONLY)', () => {
        test.each(['miseenplace', 'miseenplace_dev'])('throws for %s', (database) => {
            expect(() =>
                assertSafeDatabase(TEST_ONLY, { DATABASE_URL: `${SERVER}/${database}` }),
            ).toThrow(/Refusing to run against database/);
        });

        test('passes for miseenplace_test, ignoring query parameters', () => {
            const name = assertSafeDatabase(TEST_ONLY, {
                DATABASE_URL: `${SERVER}/miseenplace_test?schema=public`,
            });
            expect(name).toBe('miseenplace_test');
        });
    });

    describe('seed (TEST_OR_DEV)', () => {
        test.each(['miseenplace_dev', 'miseenplace_test'])('passes for %s', (database) => {
            expect(assertSafeDatabase(TEST_OR_DEV, { DATABASE_URL: `${SERVER}/${database}` })).toBe(
                database,
            );
        });

        test('throws for miseenplace', () => {
            expect(() =>
                assertSafeDatabase(TEST_OR_DEV, { DATABASE_URL: `${SERVER}/miseenplace` }),
            ).toThrow(/Refusing to run against database/);
        });
    });

    test('throws when NODE_ENV is production, even for a _test database', () => {
        expect(() =>
            assertSafeDatabase(TEST_ONLY, {
                DATABASE_URL: `${SERVER}/miseenplace_test`,
                NODE_ENV: 'production',
            }),
        ).toThrow(/production/);
    });

    test('throws when DATABASE_URL is missing or invalid', () => {
        expect(() => assertSafeDatabase(TEST_ONLY, {})).toThrow(/not set/);
        expect(() => assertSafeDatabase(TEST_ONLY, { DATABASE_URL: 'not a url' })).toThrow(
            /not a valid URL/,
        );
    });

    test('never puts the password in its error message', () => {
        expect(() =>
            assertSafeDatabase(TEST_ONLY, { DATABASE_URL: `${SERVER}/miseenplace` }),
        ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('s3cret') }));
    });
});

describe('cleanDatabase', () => {
    afterAll(async () => {
        await prisma.$disconnect();
    });

    test('refuses a non-test DATABASE_URL before deleting anything', async () => {
        await resetWithBaseSeed();
        const ingredientsBefore = await prisma.ingredient.count();
        expect(ingredientsBefore).toBeGreaterThan(0);

        // Point the guard at a _dev database. The Prisma client stays connected
        // to the test database, so even a broken guard couldn't reach dev data.
        const original = process.env.DATABASE_URL as string;
        process.env.DATABASE_URL = original.replace(/_test(?=\?|$)/, '_dev');
        try {
            await expect(cleanDatabase()).rejects.toThrow(/Refusing to run against database/);
        } finally {
            process.env.DATABASE_URL = original;
        }

        expect(await prisma.ingredient.count()).toBe(ingredientsBefore);
        await cleanDatabase();
    });
});
