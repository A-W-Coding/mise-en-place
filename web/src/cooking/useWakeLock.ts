/**
 * @module web/src/cooking/useWakeLock
 * Keeps the screen on while cooking mode is on (technical spec §3.4), through
 * the Screen Wake Lock API: Firefox 126 and later, and Chromium.
 *
 * The browser drops the lock whenever the page is hidden (another app, the
 * screen off), so it's asked for again each time the page becomes visible.
 * Turning the switch off, or leaving the recipe, releases it.
 */

import { useEffect, useState } from 'react';

/**
 * - `off`: cooking mode is off.
 * - `on`: the screen is being kept on.
 * - `unsupported`: this browser has no wake lock, so the screen may sleep.
 * - `refused`: the browser said no (battery saver, say), so the screen may sleep.
 */
export type WakeLockStatus = 'off' | 'on' | 'unsupported' | 'refused';

export function isWakeLockSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function useWakeLock(enabled: boolean): WakeLockStatus {
    const supported = isWakeLockSupported();
    // The latest answer to a request; only read while enabled
    const [granted, setGranted] = useState(true);

    useEffect(() => {
        if (!enabled || !supported) return;

        let lock: WakeLockSentinel | null = null;
        let stopped = false;

        const acquire = async () => {
            // A hidden page can't hold a lock; it's asked for again when the page is visible
            if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
            try {
                const sentinel = await navigator.wakeLock.request('screen');
                if (stopped) {
                    void sentinel.release();
                    return;
                }
                lock = sentinel;
                setGranted(true);
            } catch {
                if (!stopped) setGranted(false);
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void acquire();
        };

        void acquire();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            stopped = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (lock && !lock.released) void lock.release();
        };
    }, [enabled, supported]);

    if (!enabled) return 'off';
    if (!supported) return 'unsupported';
    return granted ? 'on' : 'refused';
}
