/**
 * @module src/middleware/cors
 * Cross-origin (CORS) policy for the API (S1).
 *
 * Browsers only let a page on another origin read API responses if the
 * API says that origin is allowed. The allowed origins come from the
 * `CORS_ORIGINS` environment variable, comma-separated:
 *
 *     CORS_ORIGINS=http://localhost:5173,https://recipes.example.ts.net
 *
 * If it's unset or empty, no other origin is allowed. There is no `*`
 * wildcard. Phase 3 note: if the UI is served from the same origin as the
 * API (the same `ts.net` host), CORS isn't needed at all.
 */

import cors from 'cors';

/**
 * Split a `CORS_ORIGINS` value into a list of origins.
 * Spaces and trailing slashes are removed, because a browser's `Origin`
 * header never has a trailing slash.
 *
 * @example
 * parseCorsOrigins(' http://localhost:5173/ , https://a.example'); // ['http://localhost:5173', 'https://a.example']
 * parseCorsOrigins(undefined); // []
 */
export function parseCorsOrigins(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);
}

/**
 * Build the CORS middleware for a list of allowed origins.
 *
 * With no origins, `origin: false` makes the `cors` package add no CORS
 * headers at all, so browsers block every cross-origin read. Allowed
 * origins may also read `X-Total-Count`, which carries list totals (D6).
 *
 * @param origins - Allowed origins (defaults to `CORS_ORIGINS`).
 */
export function corsPolicy(origins: string[] = parseCorsOrigins(process.env.CORS_ORIGINS)) {
    return cors({
        origin: origins.length > 0 ? origins : false,
        exposedHeaders: ['X-Total-Count'],
    });
}
