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
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { Ingredient, Recipe } from '../api/types';
import { offlineStorage } from './storage';

/** What `GET /api/sync` returns. 3b adds tags and equipment. */
export interface Snapshot {
    recipes: Recipe[];
    ingredients: Ingredient[];
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
    const named = (item: unknown): item is Record<string, unknown> =>
        isObject(item) && typeof item.id === 'string' && typeof item.name === 'string';
    return (
        value.recipes.every((recipe) => named(recipe) && Array.isArray(recipe.recipeIngredients)) &&
        value.ingredients.every(named)
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
