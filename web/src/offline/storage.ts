/**
 * @module web/src/offline/storage
 * Where the offline copy is kept: IndexedDB, through idb-keyval (technical
 * spec §3.4).
 *
 * It's one database, "mise-en-place", with one object store, "offline",
 * holding a few records by key. A database of its own, rather than
 * idb-keyval's default one, gives it a recognisable name in the browser's
 * storage tools.
 *
 * The component and unit tests run in jsdom, which has no IndexedDB, so they
 * swap in `memoryStorage()`. The Playwright tests use the real thing.
 */

import { createStore, getMany, setMany, type UseStore } from 'idb-keyval';

export interface OfflineStorage {
    /** Read several records in one go; a missing one is undefined. */
    getMany(keys: string[]): Promise<unknown[]>;
    /** Write several records in one transaction, so either all of them are stored or none is. */
    setMany(entries: [string, unknown][]): Promise<void>;
}

let database: UseStore | null = null;

// Opened on first use, inside the async functions, so a browser without IndexedDB
// gets a rejected promise to handle rather than an error while the app loads
function store(): UseStore {
    database ??= createStore('mise-en-place', 'offline');
    return database;
}

const indexedDbStorage: OfflineStorage = {
    getMany: async (keys) => getMany(keys, store()),
    setMany: async (entries) => setMany(entries, store()),
};

/**
 * Storage in memory, for tests. Values are cloned on the way in and out, as
 * IndexedDB does, so a test can't pass by changing a stored object in place.
 */
export function memoryStorage(): OfflineStorage {
    const records = new Map<string, unknown>();
    return {
        getMany: async (keys) => keys.map((key) => structuredClone(records.get(key))),
        setMany: async (entries) => {
            for (const [key, value] of entries) records.set(key, structuredClone(value));
        },
    };
}

let current: OfflineStorage = indexedDbStorage;

export function offlineStorage(): OfflineStorage {
    return current;
}

/** Replace the storage, for tests. */
export function setOfflineStorage(storage: OfflineStorage): void {
    current = storage;
}
