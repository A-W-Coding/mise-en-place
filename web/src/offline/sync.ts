/**
 * @module web/src/offline/sync
 * Keeping the offline copy fresh (technical spec §3.4, "Offline").
 *
 * - **When:** at the moments every page already refreshes: the app starts,
 *   comes back to the front, or gets its connection back, this device saves
 *   a change, or Refresh is tapped. It follows TanStack Query's focus signal,
 *   and the browser's own "online" event.
 * - **Retrying:** a refresh that fails is tried again while the app is on
 *   screen, after 15 seconds, then at doubling intervals up to every 5
 *   minutes, until one gets through. It doesn't wait for the browser's
 *   "online" signal, which only means the device has a network: the Pi may
 *   still be out of reach, with Tailscale off, say. Nothing retries while
 *   the app is hidden; coming back to it is a refresh moment of its own,
 *   and each moment starts the schedule afresh.
 * - **Reconnecting:** the "online" event can come a moment before requests
 *   get through (Tailscale reconnecting, say), so a refresh that fails right
 *   after it is tried again after 3 seconds, before the usual schedule.
 * - **Uploads first:** each round uploads the changes waiting on the device
 *   (Step 17, `upload.ts`), then fetches the snapshot, so the snapshot
 *   already holds them. If the Pi can't be reached, the round stops there.
 * - **Afterwards:** once a round succeeds, any page showing the copy fetches
 *   again from the API.
 */

import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, apiRequestIfChanged } from '../api/client';
import { cacheThumbnails } from '../images/media';
import { confirmOfflineCopy, getOfflineCopyState, isSnapshot, loadOfflineCopy, replaceOfflineCopy } from './copy';
import { servedFromCopy } from './read';
import { uploadWaitingChanges } from './upload';

export const FIRST_RETRY_MS = 15_000;
export const MAX_RETRY_MS = 5 * 60_000;
/** The retry after a refresh that failed just as the connection came back. */
export const RECONNECT_RETRY_MS = 3_000;

/** How long to wait after the nth failure in a row: 15 s, 30 s, 1, 2 and 4 min, then 5 min each time. */
export function retryDelay(failures: number): number {
    return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS);
}

/**
 * Fetch the snapshot, unless the copy is current, and keep it only if it
 * arrived whole.
 *
 * @returns 'replaced' for a new snapshot, 'current' for a 304.
 * @throws ApiError when the API can't be reached or answers with an error,
 *         or an Error when the new snapshot can't be stored. The copy is
 *         left as it was.
 */
export async function refreshOfflineCopy(): Promise<'replaced' | 'current'> {
    const copy = await loadOfflineCopy();
    const result = await apiRequestIfChanged<unknown>('/api/sync', copy?.etag ?? null);
    if (!result.changed) {
        await confirmOfflineCopy();
        return 'current';
    }
    // A body cut off partway, or a page that isn't the API's: either way, the snapshot didn't arrive
    if (!isSnapshot(result.data)) throw new ApiError(0, NETWORK_ERROR_MESSAGE);
    try {
        await replaceOfflineCopy(result.data, result.etag);
    } catch (error) {
        throw new Error("Couldn't store the copy on this device.", { cause: error });
    }
    return 'replaced';
}

export interface SyncStatus {
    /** A refresh is on its way. */
    refreshing: boolean;
    /** Why the last refresh failed, or null if it succeeded or none has finished. */
    lastError: string | null;
}

let client: QueryClient | null = null;
let unsubscribe: (() => void)[] = [];
let inFlight: Promise<void> | null = null;
// A moment that came while a refresh was on its way: another follows it, so a
// change saved meanwhile isn't missed
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
// The connection has just come back, and no refresh has failed since
let reconnected = false;
let status: SyncStatus = { refreshing: false, lastError: null };
const listeners = new Set<() => void>();

function setStatus(next: Partial<SyncStatus>): void {
    status = { ...status, ...next };
    for (const listener of listeners) listener();
}

function cancelRetry(): void {
    clearTimeout(retryTimer);
    retryTimer = undefined;
}

function scheduleRetry(): void {
    cancelRetry();
    if (!focusManager.isFocused()) return;
    let delay = retryDelay(failures);
    if (reconnected) {
        // A quick retry, not counted, so the usual schedule follows it from the start
        reconnected = false;
        failures = 0;
        delay = RECONNECT_RETRY_MS;
    }
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!inFlight) void attempt();
    }, delay);
}

function attempt(): Promise<void> {
    const owner = client;
    if (!owner) return Promise.resolve();
    setStatus({ refreshing: true });
    const run = (async () => {
        try {
            await uploadWaitingChanges(owner);
            await refreshOfflineCopy();
            // Thumbnails for offline (3b), in the background: the refresh has succeeded either way
            const copy = getOfflineCopyState().copy;
            if (copy) void cacheThumbnails(copy.data).catch((error: unknown) => console.warn("Thumbnails couldn't be cached.", error));
            if (client !== owner) return;
            failures = 0;
            reconnected = false;
            setStatus({ lastError: null });
            void owner.invalidateQueries({ predicate: (query) => servedFromCopy(query.state.data) });
        } catch (error) {
            if (client !== owner) return;
            failures += 1;
            setStatus({ lastError: error instanceof Error ? error.message : String(error) });
            scheduleRetry();
        }
    })();
    const settled = run.finally(() => {
        // stopSync() let go of this one
        if (inFlight !== settled) return;
        inFlight = null;
        setStatus({ refreshing: false });
        if (again && client === owner) {
            again = false;
            cancelRetry();
            failures = 0;
            void attempt();
        }
    });
    inFlight = settled;
    return settled;
}

/**
 * A refresh moment: refresh now, starting the retry schedule afresh. Does
 * nothing until `startSync()`, so component tests that don't start it see
 * the pages alone.
 */
export function requestSync(): void {
    if (!client) return;
    failures = 0;
    cancelRetry();
    if (inFlight) {
        again = true;
        return;
    }
    void attempt();
}

/**
 * A page couldn't reach the API and showed the copy instead: make sure a
 * retry is coming, so the page catches up by itself once the API answers.
 */
export function noteUnreachable(): void {
    if (!client || inFlight || retryTimer !== undefined) return;
    failures += 1;
    scheduleRetry();
}

/** Start keeping the copy fresh, with a first refresh now: the app has just started. */
export function startSync(queryClient: QueryClient): () => void {
    stopSync();
    client = queryClient;
    // TanStack Query assumes it starts online, and only hears of a change. An app
    // started with no network would then never refetch its pages when the
    // network came back
    onlineManager.setOnline(navigator.onLine);
    // The browser's own event, heard directly: it doesn't depend on what
    // TanStack Query believed before it
    const online = () => {
        reconnected = true;
        requestSync();
    };
    window.addEventListener('online', online);
    unsubscribe = [
        focusManager.subscribe((focused) => (focused ? requestSync() : cancelRetry())),
        () => window.removeEventListener('online', online),
    ];
    requestSync();
    return stopSync;
}

/** Stop, for tests. A refresh already on its way finishes, but changes nothing more. */
export function stopSync(): void {
    for (const stop of unsubscribe) stop();
    unsubscribe = [];
    cancelRetry();
    client = null;
    inFlight = null;
    again = false;
    failures = 0;
    reconnected = false;
    status = { refreshing: false, lastError: null };
}

/** For tests: resolves once no refresh is on its way. */
export async function syncSettled(): Promise<void> {
    while (inFlight) await inFlight;
}

export function getSyncStatus(): SyncStatus {
    return status;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useSyncStatus(): SyncStatus {
    return useSyncExternalStore(subscribe, getSyncStatus);
}
