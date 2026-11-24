import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NETWORK_ERROR_MESSAGE } from '../api/client';
import { beefChili, DAY_MS, lemonDrizzle, seedCopy, snapshotOf } from '../test/fixtures';
import { json, mockApi, sent, unreachable } from '../test/renderApp';
import { getOfflineCopyState, loadOfflineCopy, resetOfflineCopy, type Snapshot } from './copy';
import { memoryStorage, setOfflineStorage } from './storage';
import {
    getSyncStatus,
    noteUnreachable,
    refreshOfflineCopy,
    requestSync,
    retryDelay,
    startSync,
    syncSettled,
} from './sync';

const NOW = new Date('2026-11-24T09:00:00Z');

/** `GET /api/sync` answering with this snapshot, or 304 when asked about its ETag. */
function snapshotResponse(snapshot: Snapshot, etag: string) {
    return (_url: URL, init: RequestInit) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        if (headers['If-None-Match'] === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
        return json(snapshot, { headers: { ETag: etag } });
    };
}

/** The copy as a fresh start of the app would read it from storage. */
async function storedCopy() {
    resetOfflineCopy();
    return loadOfflineCopy();
}

beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('retryDelay', () => {
    test('15 s, then doubling, up to every 5 minutes', () => {
        expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([
            15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
        ]);
    });
});

describe('refreshOfflineCopy', () => {
    test('the first refresh fetches the whole snapshot and keeps it', async () => {
        const fetchMock = mockApi([['GET', '/api/sync', snapshotResponse(snapshotOf([beefChili]), '"s1"')]]);

        expect(await refreshOfflineCopy()).toBe('replaced');

        expect(sent(fetchMock, 'GET')[0].headers).not.toHaveProperty('If-None-Match');
        expect(await storedCopy()).toEqual({
            data: snapshotOf([beefChili]),
            etag: '"s1"',
            fetchedAt: NOW.getTime(),
            checkedAt: NOW.getTime(),
        });
    });

    test('a 304 keeps the copy as it is, and notes when it was confirmed', async () => {
        await seedCopy([beefChili], 3 * DAY_MS, '"s1"');
        const fetchMock = mockApi([['GET', '/api/sync', snapshotResponse(snapshotOf([lemonDrizzle]), '"s1"')]]);

        expect(await refreshOfflineCopy()).toBe('current');

        expect(sent(fetchMock, 'GET')[0].headers['If-None-Match']).toBe('"s1"');
        const copy = await storedCopy();
        expect(copy?.data).toEqual(snapshotOf([beefChili]));
        expect(copy?.fetchedAt).toBe(NOW.getTime() - 3 * DAY_MS);
        expect(copy?.checkedAt).toBe(NOW.getTime());
    });

    test('a changed snapshot replaces the copy', async () => {
        await seedCopy([beefChili], DAY_MS, '"s1"');
        mockApi([['GET', '/api/sync', snapshotResponse(snapshotOf([beefChili, lemonDrizzle]), '"s2"')]]);

        expect(await refreshOfflineCopy()).toBe('replaced');

        const copy = await storedCopy();
        expect(copy?.etag).toBe('"s2"');
        expect(copy?.data.recipes.map((recipe) => recipe.name)).toEqual(['Beef Chili', 'Lemon Drizzle Cake']);
    });

    const cutOff = () => {
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"recipes": [{"id": "0b9e'));
                controller.error(new TypeError('network error'));
            },
        });
        return new Response(body, { status: 200, headers: { ETag: '"s2"' } });
    };

    test.each<[string, () => Response]>([
        ["the API can't be reached", () => unreachable()],
        ['the API answers with an error', () => json({ error: 'Something went wrong.' }, { status: 500 })],
        ['the connection drops partway through the body', cutOff],
        ['the body is cut short', () => new Response('{"recipes": [', { status: 200, headers: { ETag: '"s2"' } })],
        ["something that isn't the API answers", () => new Response('<html>Sign in to Wi-Fi</html>', { status: 200 })],
    ])('when %s, the copy is left exactly as it was', async (_case, respond) => {
        await seedCopy([beefChili], DAY_MS, '"s1"');
        const before = getOfflineCopyState();
        mockApi([['GET', '/api/sync', respond]]);

        await expect(refreshOfflineCopy()).rejects.toThrow();

        expect(getOfflineCopyState()).toBe(before);
        expect(await storedCopy()).toEqual(before.copy);
    });

    test("when the new snapshot can't be stored, the old copy stays", async () => {
        await seedCopy([beefChili], DAY_MS, '"s1"');
        const before = getOfflineCopyState();
        const storage = memoryStorage();
        await storage.setMany([['snapshot', { data: snapshotOf([beefChili]), etag: '"s1"', fetchedAt: 1 }]]);
        setOfflineStorage({ ...storage, setMany: () => Promise.reject(new DOMException('Full', 'QuotaExceededError')) });
        mockApi([['GET', '/api/sync', snapshotResponse(snapshotOf([lemonDrizzle]), '"s2"')]]);

        await expect(refreshOfflineCopy()).rejects.toThrow("Couldn't store the copy on this device.");
        expect(getOfflineCopyState()).toBe(before);
    });
});

describe('the refresh schedule', () => {
    /** Answer /api/sync by calling `respond`, noting how long after the start each request came. */
    function syncRoute(respond: () => Response) {
        const times: number[] = [];
        const fetchMock = mockApi([
            [
                'GET',
                '/api/sync',
                () => {
                    times.push(Date.now() - NOW.getTime());
                    return respond();
                },
            ],
        ]);
        return { times, fetchMock };
    }

    test('does nothing until it starts', async () => {
        const { times } = syncRoute(() => unreachable());

        requestSync();
        noteUnreachable();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(times).toEqual([]);
    });

    test('a failed refresh is retried after 15 s, then at doubling intervals up to every 5 minutes', async () => {
        const { times } = syncRoute(() => unreachable());

        startSync(new QueryClient());
        await vi.advanceTimersByTimeAsync(20 * 60_000);

        expect(times).toEqual([0, 15_000, 45_000, 105_000, 225_000, 465_000, 765_000, 1_065_000]);
        expect(getSyncStatus().lastError).toBe(NETWORK_ERROR_MESSAGE);
    });

    test("retries wait while the app is hidden; coming back refreshes at once, and starts the schedule afresh", async () => {
        const { times } = syncRoute(() => unreachable());
        startSync(new QueryClient());
        await vi.advanceTimersByTimeAsync(50_000);
        expect(times).toEqual([0, 15_000, 45_000]);

        focusManager.setFocused(false);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(times).toHaveLength(3);

        focusManager.setFocused(true);
        await vi.advanceTimersByTimeAsync(15_000);
        const back = 50_000 + 60 * 60_000;
        expect(times).toEqual([0, 15_000, 45_000, back, back + 15_000]);
    });

    test('the connection coming back refreshes at once', async () => {
        const { times } = syncRoute(() => unreachable());
        startSync(new QueryClient());
        await vi.advanceTimersByTimeAsync(5_000);

        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
        await vi.advanceTimersByTimeAsync(0);

        expect(times).toEqual([0, 5_000]);
    });

    test('once a refresh gets through, retries stop and pages showing the copy fetch again', async () => {
        let reachable = false;
        const snapshot = snapshotOf([beefChili]);
        mockApi([['GET', '/api/sync', () => (reachable ? json(snapshot, { headers: { ETag: '"s1"' } }) : unreachable())]]);
        const queryClient = new QueryClient();
        queryClient.setQueryData(['recipes', 'detail', 'a'], { data: beefChili, etag: null, totalCount: null, fromCopy: true });
        queryClient.setQueryData(['recipes', 'detail', 'b'], { data: lemonDrizzle, etag: '"1"', totalCount: null });

        startSync(queryClient);
        await vi.advanceTimersByTimeAsync(0);
        expect(getSyncStatus().lastError).toBe(NETWORK_ERROR_MESSAGE);

        reachable = true;
        await vi.advanceTimersByTimeAsync(15_000);

        expect(getOfflineCopyState().copy?.etag).toBe('"s1"');
        expect(getSyncStatus()).toEqual({ refreshing: false, lastError: null });
        expect(queryClient.getQueryState(['recipes', 'detail', 'a'])?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(['recipes', 'detail', 'b'])?.isInvalidated).toBe(false);
    });

    test('a refresh moment during a refresh brings another one after it, so a change saved meanwhile is caught', async () => {
        let answer: (response: Response) => void = () => {};
        let calls = 0;
        mockApi([
            [
                'GET',
                '/api/sync',
                () => {
                    calls += 1;
                    return calls === 1
                        ? new Promise<Response>((resolve) => (answer = resolve))
                        : json(snapshotOf([beefChili, lemonDrizzle]), { headers: { ETag: '"s2"' } });
                },
            ],
        ]);
        startSync(new QueryClient());
        await vi.advanceTimersByTimeAsync(0);
        expect(getSyncStatus().refreshing).toBe(true);

        requestSync();
        expect(calls).toBe(1);
        answer(json(snapshotOf([beefChili]), { headers: { ETag: '"s1"' } }));
        await vi.advanceTimersByTimeAsync(0);
        await syncSettled();

        expect(calls).toBe(2);
        expect(getOfflineCopyState().copy?.etag).toBe('"s2"');
    });

    test('a page that fell back to the copy makes sure a retry is coming', async () => {
        const { times } = syncRoute(() => json(snapshotOf([beefChili]), { headers: { ETag: '"s1"' } }));
        startSync(new QueryClient());
        await vi.advanceTimersByTimeAsync(0);

        noteUnreachable();
        noteUnreachable();
        await vi.advanceTimersByTimeAsync(20_000);

        expect(times).toEqual([0, 15_000]);
    });
});
