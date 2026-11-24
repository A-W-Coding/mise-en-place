/**
 * @module web/src/offline/copy
 * The offline copy: the latest snapshot from `GET /api/sync`, kept on this
 * device so every recipe can be read with no connection (D8, technical spec
 * §3.4, "Offline").
 *
 * - It's one record, the snapshot with its ETag and when it was fetched, and
 *   it never expires. It's replaced only by a complete newer snapshot (see
 *   `sync.ts`), so a failed refresh never leaves the device with less.
 * - `checkedAt` is when the API last said the copy was current, by sending
 *   it or by answering 304 since. It's a small record of its own, so
 *   confirming the copy doesn't rewrite the whole snapshot.
 * - It's read from storage once, then kept in memory as well. Components
 *   follow it with `useOfflineCopy()`.
 * - When this device uploads a change (Step 17), the API's reply goes into
 *   the copy straight away (`putRecipeInCopy()`), so a page never steps back
 *   to the old version while the next snapshot loads.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { Equipment, Ingredient, Recipe, Tag } from '../api/types';
import { offlineStorage } from './storage';

/** What `GET /api/sync` returns. */
export interface Snapshot {
    recipes: Recipe[];
    ingredients: Ingredient[];
    /** Each recipe's ETag, by id, for `If-Match` when it's edited from the copy. */
    etags: Record<string, string>;
    /** Every tag and every item of equipment (3b), by name. */
    tags: Tag[];
    equipment: Equipment[];
}

export interface OfflineCopy {
    data: Snapshot;
    /** The snapshot's ETag, sent back in `If-None-Match`. */
    etag: string | null;
    /** When this snapshot arrived, in ms since the epoch. */
    fetchedAt: number;
    /** When the API last said it was current. */
    checkedAt: number;
}

export type OfflineCopyState =
    /** Still being read from storage. */
    | { status: 'loading'; copy: null }
    | { status: 'ready'; copy: OfflineCopy | null };

interface StoredSnapshot {
    data: Snapshot;
    etag: string | null;
    fetchedAt: number;
}

const SNAPSHOT_KEY = 'snapshot';
const CHECKED_KEY = 'snapshotCheckedAt';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Whether a value has the snapshot's shape. A response cut off partway fails
 * to parse, and a captive portal's page isn't JSON, so neither passes.
 */
export function isSnapshot(value: unknown): value is Snapshot {
    if (!isObject(value) || !Array.isArray(value.recipes) || !Array.isArray(value.ingredients)) return false;
    if (!isObject(value.etags) || !Object.values(value.etags).every((etag) => typeof etag === 'string')) return false;
    const named = (item: unknown): item is Record<string, unknown> =>
        isObject(item) && typeof item.id === 'string' && typeof item.name === 'string';
    // A copy from before 3b has no sections, tags or equipment, and is fetched again whole rather than shown broken
    if (!Array.isArray(value.tags) || !Array.isArray(value.equipment)) return false;
    return (
        value.recipes.every(
            (recipe) =>
                named(recipe) &&
                Array.isArray(recipe.recipeIngredients) &&
                Array.isArray(recipe.sections) &&
                Array.isArray(recipe.tags) &&
                Array.isArray(recipe.equipment),
        ) &&
        value.ingredients.every(named) &&
        value.tags.every(named) &&
        value.equipment.every(named)
    );
}

let state: OfflineCopyState = { status: 'loading', copy: null };
let loading: Promise<void> | null = null;
// Bumped by resetOfflineCopy(), so a read begun before a reset can't land after it
let generation = 0;
const listeners = new Set<() => void>();

function update(next: OfflineCopyState): void {
    state = next;
    for (const listener of listeners) listener();
}

/** Read the copy from storage into memory, unless a newer one has arrived meanwhile. */
async function readFromStorage(started: number): Promise<void> {
    let copy: OfflineCopy | null = null;
    try {
        const [stored, checkedAt] = await offlineStorage().getMany([SNAPSHOT_KEY, CHECKED_KEY]);
        if (isObject(stored) && isSnapshot(stored.data) && typeof stored.fetchedAt === 'number') {
            const record = stored as unknown as StoredSnapshot;
            copy = { ...record, checkedAt: typeof checkedAt === 'number' ? checkedAt : record.fetchedAt };
        }
    } catch (error) {
        console.warn("The offline copy couldn't be read.", error);
    }
    if (generation === started && state.status === 'loading') update({ status: 'ready', copy });
}

/**
 * The copy as it is now, after reading it from storage the first time it's
 * asked for. Resolves to null when there's none yet, or storage can't be
 * read: the app then works as it does online, with no copy to fall back on.
 */
export async function loadOfflineCopy(): Promise<OfflineCopy | null> {
    loading ??= readFromStorage(generation);
    await loading;
    // Not what the first read found: a refresh may have stored a newer copy since
    return state.copy;
}

/**
 * Keep a complete new snapshot in place of the old one. The copy in memory
 * changes only once it's stored, so the two always agree.
 */
export async function replaceOfflineCopy(data: Snapshot, etag: string | null, now = Date.now()): Promise<void> {
    const stored: StoredSnapshot = { data, etag, fetchedAt: now };
    await offlineStorage().setMany([
        [SNAPSHOT_KEY, stored],
        [CHECKED_KEY, now],
    ]);
    update({ status: 'ready', copy: { ...stored, checkedAt: now } });
}

/** Put an item in a list kept in the API's order, by name then id, replacing any with the same id. */
function placeByName<T extends { id: string; name: string }>(items: T[], item: T): T[] {
    const others = items.filter((existing) => existing.id !== item.id);
    const after = others.findIndex(
        (existing) => existing.name.localeCompare(item.name) > 0 || (existing.name === item.name && existing.id > item.id),
    );
    return after === -1 ? [...others, item] : [...others.slice(0, after), item, ...others.slice(after)];
}

/**
 * Put a recipe the API has just sent back into the copy, with its ETag and
 * any ingredients, tags and equipment the copy hasn't got yet. The copy
 * keeps its snapshot ETag, so the next refresh still fetches the whole
 * snapshot.
 */
export async function putRecipeInCopy(recipe: Recipe, etag: string | null): Promise<void> {
    const copy = await loadOfflineCopy();
    if (!copy) return;
    const addMissing = <T extends { id: string; name: string }>(items: T[], found: T[]) =>
        found.reduce((list, item) => (list.some((existing) => existing.id === item.id) ? list : placeByName(list, item)), items);
    const ingredients = addMissing(copy.data.ingredients, recipe.recipeIngredients.map((line) => line.ingredient));
    const tags = addMissing(copy.data.tags, recipe.tags.map((line) => line.tag));
    const equipment = addMissing(copy.data.equipment, recipe.equipment.map((line) => line.equipment));
    const etags = { ...copy.data.etags };
    if (etag) etags[recipe.id] = etag;
    else delete etags[recipe.id];
    const data: Snapshot = { recipes: placeByName(copy.data.recipes, recipe), ingredients, etags, tags, equipment };
    const stored: StoredSnapshot = { data, etag: copy.etag, fetchedAt: copy.fetchedAt };
    await offlineStorage().setMany([[SNAPSHOT_KEY, stored]]);
    update({ status: 'ready', copy: { ...copy, data } });
}

/** The API says the copy is still current (a 304). */
export async function confirmOfflineCopy(now = Date.now()): Promise<void> {
    const { copy } = state;
    if (!copy) return;
    await offlineStorage().setMany([[CHECKED_KEY, now]]);
    update({ status: 'ready', copy: { ...copy, checkedAt: now } });
}

export function getOfflineCopyState(): OfflineCopyState {
    return state;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The copy as it stands, read from storage if it hasn't been yet, re-rendering when it's loaded, replaced or confirmed. */
export function useOfflineCopy(): OfflineCopyState {
    useEffect(() => {
        void loadOfflineCopy();
    }, []);
    return useSyncExternalStore(subscribe, getOfflineCopyState);
}

/** Forget the copy in memory, so the next read comes from storage. For tests. */
export function resetOfflineCopy(): void {
    generation += 1;
    loading = null;
    update({ status: 'loading', copy: null });
}
