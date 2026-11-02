/**
 * @module src/utils/fuzzy-search
 * Hybrid fuzzy search combining PostgreSQL pg_trgm trigram matching
 * with ILIKE substring matching.
 *
 * Trigram matching catches typos and misspellings (e.g. "beff" → "Beef Chili").
 * ILIKE catches exact substrings that may score low on short words.
 * Results are ranked by descending similarity so the best match comes first.
 *
 * All SQL goes through the tagged-template `$queryRaw`, which sends every
 * `${value}` as a bound parameter, never as text spliced into the query.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import type { Page } from '../schemas/list-query.js';

/** A single fuzzy-match result with its computed similarity score. */
export interface FuzzyMatch {
    id: string;
    similarity: number;
}

/** One page of fuzzy-match results, plus how many matched in total. */
export interface FuzzyPage {
    matches: FuzzyMatch[];
    total: number;
}

/** Tables that support fuzzy name search. */
export type SearchableTable = 'Recipe' | 'Ingredient';

/**
 * The SQL identifier for each searchable table. A table name can't be a
 * bound parameter, so it comes from this fixed map, never from input.
 */
const TABLES: Record<SearchableTable, Prisma.Sql> = {
    Recipe: Prisma.sql`"Recipe"`,
    Ingredient: Prisma.sql`"Ingredient"`,
};

/** Default trigram similarity threshold (0 – 1). */
const DEFAULT_THRESHOLD = 0.3;

/**
 * Escape the characters that are special in a LIKE/ILIKE pattern
 * (`\`, `%` and `_`) so they match literally. Postgres uses `\` as the
 * default LIKE escape character.
 *
 * @example
 * escapeLikePattern('50%_off'); // '50\\%\\_off'
 */
export function escapeLikePattern(term: string): string {
    return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Execute a hybrid fuzzy search against the `name` column of a table.
 *
 * Combines `word_similarity` (pg_trgm) with an `ILIKE` fallback so that
 * both misspellings and exact substrings are captured. ILIKE-only hits
 * receive a baseline similarity of 0.5 so they sort reasonably.
 *
 * Results are ordered by similarity, then name, then id, so equal scores
 * always come back in the same order and pages never overlap. The page is
 * cut in SQL; a second query counts every match for `X-Total-Count`.
 *
 * @param table      - Prisma model name (`'Recipe'` or `'Ingredient'`).
 * @param searchTerm - Search string from the client (will be lowercased).
 * @param page       - `limit` and `offset` of the page to return.
 * @param threshold  - Minimum trigram similarity to qualify (default 0.3).
 * @returns One page of matches, best first, and the total number of matches.
 */
export async function fuzzySearchByName(
    table: SearchableTable,
    searchTerm: string,
    page: Page,
    threshold: number = DEFAULT_THRESHOLD,
): Promise<FuzzyPage> {
    const term = searchTerm.toLowerCase();
    const pattern = `%${escapeLikePattern(term)}%`;
    const matchesTerm = Prisma.sql`word_similarity(${term}, name) > ${threshold} OR name ILIKE ${pattern}`;

    const [matches, [{ total }]] = await Promise.all([
        prisma.$queryRaw<FuzzyMatch[]>`
            SELECT id,
                   GREATEST(
                       word_similarity(${term}, name),
                       CASE WHEN name ILIKE ${pattern} THEN 0.5 ELSE 0 END
                   ) AS similarity
            FROM ${TABLES[table]}
            WHERE ${matchesTerm}
            ORDER BY similarity DESC, name, id
            LIMIT ${page.limit} OFFSET ${page.offset}`,
        prisma.$queryRaw<[{ total: number }]>`
            SELECT count(*)::int AS total FROM ${TABLES[table]} WHERE ${matchesTerm}`,
    ]);

    return { matches, total };
}
