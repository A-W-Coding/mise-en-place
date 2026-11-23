/**
 * @module web/src/api/errorMessage
 * What to tell the cook when a request fails.
 */

import type { ApiError } from './client';

/** Over Tailscale, "can't reach the server" nearly always means Tailscale is off on this device. */
export function errorMessage(error: ApiError): string {
    return error.isNetworkError ? "Can't reach the server. Check Tailscale is connected, then try again." : error.message;
}
