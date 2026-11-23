/**
 * @module web/src/api/client
 * One small wrapper around `fetch` for every call the client makes to the API.
 *
 * - Sends and reads JSON, and returns the `ETag` (for `If-Match`, F3) and the
 *   `X-Total-Count` list total (D6) alongside the body.
 * - Turns every failure into an `ApiError`: the API's `error` message and,
 *   for a 400, its per-field messages (`fields`), so forms can show each one
 *   next to its input.
 * - A request that gets no answer at all (offline, or the Pi unreachable)
 *   becomes an `ApiError` with status 0 and "Can't reach the server."
 *
 * Paths are relative ("/api/recipes"): the client is served from the same
 * origin as the API, in production and in development (F1).
 */

/** Per-field messages from a 400, keyed by dotted path, such as "ingredients.0.unit". */
export type FieldErrors = Record<string, string>;

/** The message for a request that never got an answer. */
export const NETWORK_ERROR_MESSAGE = "Can't reach the server.";

/** Any failed request: an error response from the API, or no response at all. */
export class ApiError extends Error {
    readonly status: number;
    readonly fields: FieldErrors;

    constructor(status: number, message: string, fields: FieldErrors = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.fields = fields;
    }

    /** True when the server couldn't be reached, rather than answering with an error. */
    get isNetworkError(): boolean {
        return this.status === 0 || this.message === NETWORK_ERROR_MESSAGE;
    }
}

/** A successful response: the parsed body, plus the headers the client uses. */
export interface ApiResult<T> {
    data: T;
    /** The `ETag` header, for single recipes; send it back as `ifMatch` (F3). */
    etag: string | null;
    /** The `X-Total-Count` header, for lists (D6). */
    totalCount: number | null;
}

export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    /** Sent as JSON. */
    body?: unknown;
    /** Sent as `If-Match`, so the write fails with 412 if the recipe changed elsewhere. */
    ifMatch?: string | null;
    signal?: AbortSignal;
}

/** Read a body as JSON, or null when it's empty or not JSON (a proxy's HTML error page, say). */
async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === '') return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isFieldErrors(value: unknown): value is FieldErrors {
    return isObject(value) && Object.values(value).every((message) => typeof message === 'string');
}

/**
 * Make a request to the API.
 *
 * @param path - An API path, such as "/api/recipes?search=chili".
 * @returns The parsed body with its `ETag` and `X-Total-Count`.
 * @throws ApiError for an error response or no response; an aborted request
 *         rethrows the browser's AbortError, which TanStack Query expects.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;

    let response: Response;
    try {
        response = await fetch(path, {
            method: options.method ?? 'GET',
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: options.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, NETWORK_ERROR_MESSAGE);
    }

    const body = await readJson(response);
    if (!response.ok) {
        const message = isObject(body) && typeof body.error === 'string' ? body.error : null;
        const fields = isObject(body) && isFieldErrors(body.fields) ? body.fields : {};
        // tailscale serve and the dev proxy answer 502 or 504, with no JSON, when the API is down
        const unreachable = message === null && (response.status === 502 || response.status === 504);
        throw new ApiError(
            response.status,
            message ?? (unreachable ? NETWORK_ERROR_MESSAGE : `The request failed (${response.status}).`),
            fields,
        );
    }

    const total = response.headers.get('X-Total-Count');
    return {
        data: body as T,
        etag: response.headers.get('ETag'),
        totalCount: total === null ? null : Number(total),
    };
}
