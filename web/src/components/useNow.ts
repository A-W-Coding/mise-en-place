/**
 * @module web/src/components/useNow
 * The time now, updated every so often, for text like "refreshed 5 minutes
 * ago" that should keep up while the page stays open.
 */

import { useEffect, useState } from 'react';

export function useNow(everyMs = 60_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(timer);
    }, [everyMs]);
    return now;
}
