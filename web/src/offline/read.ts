/**
 * @module web/src/offline/read
 * Answering the pages' reads from the offline copy, in the shapes the API
 * uses, for when the API can't be reached (technical spec §3.4, "Offline").
 *
 * Each answer is marked `fromCopy`. That's how the banner knows to show, and
 * how a page reading the copy knows to fetch again once the API answers. A
 * recipe carries the ETag the snapshot gave it, so it can be edited offline
 * with `If-Match` like one from the API (Step 17).
 */

import type { ApiResult } from '../api/client';
import type { Recipe } from '../api/types';
import type { OfflineCopy } from './copy';

/** An answer from the API, or from the copy. */
export type ReadResult<T> = ApiResult<T> & { fromCopy?: true };

/** One whole recipe with its ETag, or null if the copy doesn't have it (it may be newer than the copy, or deleted). */
export function recipeFromCopy(copy: OfflineCopy, id: string): ReadResult<Recipe> | null {
    const recipe = copy.data.recipes.find((candidate) => candidate.id === id);
    return recipe ? { data: recipe, etag: copy.data.etags[id] ?? null, totalCount: null, fromCopy: true } : null;
}

/**
 * One page of a list, searched on the device. The copy is already in the
 * API's order for a plain list: by name, then id.
 */
export function listFromCopy<T extends { name: string }>(
    items: T[],
    search: string,
    offset: number,
    limit: number,
): ReadResult<T[]> {
    const matching = search ? items.filter((item) => matchesSearch(item.name, search)) : items;
    return { data: matching.slice(offset, offset + limit), etag: null, totalCount: matching.length, fromCopy: true };
}

function normalise(text: string): string {
    // "Crème brûlée" and "creme brulee" match each other
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The device's search: every word typed appears somewhere in the name,
 * ignoring case and accents. Simpler than the API's fuzzy search, which
 * also forgives typos, but enough to find a recipe by name.
 */
export function matchesSearch(name: string, search: string): boolean {
    const target = normalise(name);
    return normalise(search)
        .split(/\s+/)
        .filter((word) => word !== '')
        .every((word) => target.includes(word));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** Whether a query's data came from the copy: a single answer, or any page of a list. */
export function servedFromCopy(data: unknown): boolean {
    if (!isObject(data)) return false;
    if (data.fromCopy === true) return true;
    return Array.isArray(data.pages) && data.pages.some((page) => isObject(page) && page.fromCopy === true);
}
