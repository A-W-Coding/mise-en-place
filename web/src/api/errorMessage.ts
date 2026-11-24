/**
 * @module web/src/api/errorMessage
 * What to tell the cook when a request fails.
 */

import type { ApiError } from './client';

/** Over Tailscale, "can't reach the server" nearly always means Tailscale is off on this device. */
export function errorMessage(error: ApiError): string {
    return error.isNetworkError ? "Can't reach the server. Check Tailscale is connected, then try again." : error.message;
}

/**
 * For the changes that still need the server (3c): deleting a recipe, and
 * renaming or deleting an ingredient. Offline, they say so rather than wait.
 *
 * @param action - What was tried, as a sentence starts: "Deleting a recipe".
 */
export function onlineOnlyMessage(error: ApiError, action: string): string {
    return error.isNetworkError
        ? `${action} needs a connection to the server. Check Tailscale is connected, then try again.`
        : error.message;
}
