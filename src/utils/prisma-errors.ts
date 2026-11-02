/**
 * @module src/utils/prisma-errors
 * Helpers for identifying Prisma-specific error codes.
 *
 * Prisma throws richly-typed errors whose `code` field indicates the
 * category of failure (e.g. P2025 = "Record not found", P2003 = "Foreign
 * key constraint failed"). These helpers keep route handlers clean by
 * encapsulating the type-narrowing logic.
 *
 * @see https://www.prisma.io/docs/reference/api-reference/error-reference
 */

/**
 * Check whether an unknown error is a Prisma client error with a specific code.
 *
 * @param error - The caught error value.
 * @param code  - The Prisma error code to test for (e.g. `'P2025'`).
 * @returns `true` if `error` has a matching `code` property.
 *
 * Common codes used in this project:
 *  - `P2025` — Record to update/delete not found.
 *  - `P2003` — Foreign key constraint violation.
 *  - `P2002` — Unique constraint violation (mapped to 409 in the error handler).
 */
export function isPrismaError(error: unknown, code: string): boolean {
    return (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === code
    );
}
