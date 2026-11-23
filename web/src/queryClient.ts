/**
 * @module web/src/queryClient
 * The app's one TanStack Query client.
 *
 * TanStack Query's defaults already give the refreshes "Keeping devices in
 * step" needs (technical spec §3.4): data refetches when the app comes back to
 * the front (`refetchOnWindowFocus`) and when the connection returns
 * (`refetchOnReconnect`). Nothing polls on a timer.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // One retry is enough to ride out a blip; the UI then says it can't reach the server
            retry: 1,
        },
    },
});
