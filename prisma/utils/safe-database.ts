/**
 * @module prisma/utils/safe-database
 * Guard that stops destructive helpers from running against the wrong database.
 *
 * The test reset and the seed both delete every row. Before touching
 * anything, they call `assertSafeDatabase()` with the database-name
 * suffixes they may use, so a wrong `DATABASE_URL` fails loudly instead
 * of wiping real data.
 */

/** The test reset may only touch databases whose names end in `_test`. */
export const TEST_ONLY = ['_test'] as const;

/** The seed may touch `_test` or `_dev` databases. */
export const TEST_OR_DEV = ['_test', '_dev'] as const;

/**
 * Where the guard reads its variables: `process.env`, or a plain object in tests.
 * Only `DATABASE_URL` and `NODE_ENV` are read.
 */
type GuardEnv = Readonly<Record<string, string | undefined>>;

/**
 * Throw unless `DATABASE_URL` names a database ending in one of
 * `allowedSuffixes`, and `NODE_ENV` isn't `production`.
 *
 * Error messages name the database but never include the URL, which
 * contains the password.
 *
 * @param allowedSuffixes - Accepted database-name endings, e.g. `TEST_ONLY`.
 * @param env             - Where to read the variables (defaults to `process.env`).
 * @returns The database name, for logging.
 * @throws Error if the database isn't allowed.
 */
export function assertSafeDatabase(
    allowedSuffixes: readonly string[],
    env: GuardEnv = process.env,
): string {
    if (env.NODE_ENV === 'production') {
        throw new Error('Refusing to run: NODE_ENV is "production".');
    }
    if (!env.DATABASE_URL) {
        throw new Error('Refusing to run: DATABASE_URL is not set.');
    }

    let name: string;
    try {
        name = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''));
    } catch {
        throw new Error('Refusing to run: DATABASE_URL is not a valid URL.');
    }

    if (!allowedSuffixes.some((suffix) => name.endsWith(suffix))) {
        throw new Error(
            `Refusing to run against database "${name}": only names ending in ` +
                `${allowedSuffixes.join(' or ')} are allowed here. Check DATABASE_URL.`,
        );
    }
    return name;
}
