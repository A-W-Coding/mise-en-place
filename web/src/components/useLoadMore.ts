/**
 * @module web/src/components/useLoadMore
 * Infinite scrolling: load the next page as the end of a list comes near,
 * with no button (technical spec §3.4).
 *
 * An IntersectionObserver watches an empty element after the last item. The
 * margin starts the fetch about a screen before the end is reached, so on a
 * phone the next page is usually there before you scroll to it.
 */

import { useEffect, useRef } from 'react';

/** How far below the screen the end of the list starts the next fetch. */
const AHEAD = '0px 0px 800px 0px';

/**
 * @param canLoad - True while there's a next page and none is loading.
 * @param loadMore - Fetches the next page.
 * @param pageCount - How many pages are loaded. A change re-checks the end,
 *        since a short page can leave it on screen without a new crossing.
 * @returns A ref for the element after the list.
 */
export function useLoadMore(canLoad: boolean, loadMore: () => void, pageCount: number) {
    const sentinel = useRef<HTMLDivElement>(null);
    const latest = useRef(loadMore);

    useEffect(() => {
        latest.current = loadMore;
    });

    useEffect(() => {
        const element = sentinel.current;
        if (!canLoad || !element || typeof IntersectionObserver === 'undefined') return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) latest.current();
            },
            { rootMargin: AHEAD },
        );
        // Observing always reports the current state once, so an end that's already near loads at once
        observer.observe(element);
        return () => observer.disconnect();
    }, [canLoad, pageCount]);

    return sentinel;
}
