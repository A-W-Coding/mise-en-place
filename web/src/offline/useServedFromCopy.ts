/**
 * @module web/src/offline/useServedFromCopy
 * Whether anything on screen came from the offline copy rather than the API.
 */

import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { servedFromCopy } from './read';

/** True while an active query's data came from the copy: the page is showing it. */
export function useServedFromCopy(): boolean {
    const cache = useQueryClient().getQueryCache();
    return useSyncExternalStore(
        // Batched as TanStack Query's own hooks do, since the cache changes while pages render
        useCallback((onChange) => cache.subscribe(notifyManager.batchCalls(onChange)), [cache]),
        () => cache.findAll({ type: 'active' }).some((query) => servedFromCopy(query.state.data)),
    );
}
