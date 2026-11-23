/**
 * @module web/src/components/useSearchQuery
 * The search on the recipe and ingredient lists, kept in the address as `?q=`,
 * so going back from a recipe returns to the same results, and a search can
 * be bookmarked. Typing updates the box at once, and the address (and so the
 * request) a moment after you stop, rather than on every key.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

/** How long typing has to pause before the search runs. */
export const SEARCH_DELAY_MS = 250;

export function useSearchQuery() {
    const [params, setParams] = useSearchParams();
    const search = (params.get('q') ?? '').trim();
    const [text, setText] = useState(params.get('q') ?? '');

    useEffect(() => {
        const timer = setTimeout(() => {
            const next = text.trim();
            // replace, so each pause in typing doesn't become a step in Back
            if (next !== search) setParams(next ? { q: next } : {}, { replace: true });
        }, SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [text, search, setParams]);

    const clear = () => {
        setText('');
        setParams({}, { replace: true });
    };

    return { text, setText, search, clear };
}
