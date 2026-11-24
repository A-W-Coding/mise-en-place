/**
 * @module web/src/queryClient
 * The app's one TanStack Query client.
 *
 * TanStack Query's defaults already give the refreshes "Keeping devices in
 * step" needs (technical spec §3.4): data is fetched when a page opens, and
 * again when the app comes back to the front (`refetchOnWindowFocus`, which
 * listens for `visibilitychange`) and when the connection returns
 * (`refetchOnReconnect`). Data counts as stale at once, so each of those
 * moments really fetches. Nothing polls on a timer.
 *
 * `networkMode: 'always'` (3c) lets every request go out even when the
 * browser says it's offline. Otherwise TanStack Query holds requests back
 * until the browser says it's online again: a page would wait on "Loading…"
 * instead of reading the offline copy, and a save would never say it can't
 * reach the server. The request failing is the real test either way.
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

// Every query and mutation fails with an ApiError (or an AbortError, which
// TanStack Query handles itself), so components can read `error.status`
declare module '@tanstack/react-query' {
    interface Register {
        defaultError: ApiError;
    }
}

/**
 * Retry once, to ride out a blip, but never a 4xx: a deleted recipe (404) or
 * a bad request won't change by asking again.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
    return failureCount < 1;
}

export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: shouldRetry, networkMode: 'always' },
            mutations: { networkMode: 'always' },
        },
    });
}

export const queryClient = createQueryClient();
