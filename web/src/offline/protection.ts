/**
 * @module web/src/offline/protection
 * Asking the browser not to clear the offline copy to free up space
 * (technical spec §3.4, "Keeping the browser from clearing it").
 *
 * Firefox asks you, and only in response to a tap, so the request comes from
 * the Protect button rather than happening by itself. Chrome decides on its
 * own, and allows it for installed apps.
 */

import { useEffect, useState } from 'react';

export type Protection =
    | 'checking'
    | 'protected'
    | 'unprotected'
    /** Protect was tapped and the browser said no. */
    | 'refused'
    | 'unsupported';

function supported(): boolean {
    return typeof navigator.storage?.persist === 'function' && typeof navigator.storage.persisted === 'function';
}

export function useStorageProtection(): { protection: Protection; protect: () => void } {
    const [protection, setProtection] = useState<Protection>(() => (supported() ? 'checking' : 'unsupported'));

    useEffect(() => {
        if (!supported()) return;
        let current = true;
        navigator.storage.persisted().then(
            (persisted) => current && setProtection(persisted ? 'protected' : 'unprotected'),
            () => current && setProtection('unsupported'),
        );
        return () => {
            current = false;
        };
    }, []);

    // Called straight from the tap's handler, with nothing awaited first, so Firefox sees the tap
    const protect = () => {
        navigator.storage.persist().then(
            (granted) => setProtection(granted ? 'protected' : 'refused'),
            () => setProtection('refused'),
        );
    };

    return { protection, protect };
}
