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
 *   becomes an `ApiError` with status 0 and "Can't reach the server." So
 *   does an answer cut off partway, when the connection drops mid-download.
 * - `apiRequestIfChanged()` is the conditional GET the offline copy uses
 *   (3c): it sends `If-None-Match`, and a 304 means the copy is current.
 * - Every request skips the browser's HTTP cache (`cache: 'no-store'`).
 *   TanStack Query and the offline copy are the app's caches. And Firefox,
 *   when it's offline (in airplane mode, say), answers from its HTTP cache
 *   however old the entry is, instead of failing: a page would show an old
 *   answer as if it were current, rather than the offline copy and its
 *   banner.
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

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

interface SendOptions extends RequestOptions {
    ifNoneMatch?: string | null;
}

/** Send a request, turning no answer at all into a network error. */
async function send(path: string, options: SendOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;
    if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;

    try {
        return await fetch(path, {
            method: options.method ?? 'GET',
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: options.signal,
            cache: 'no-store',
        });
    } catch (error) {
        if (isAbort(error)) throw error;
        throw new ApiError(0, NETWORK_ERROR_MESSAGE);
    }
}

/** Read a response into an `ApiResult`, or throw the `ApiError` it stands for. */
async function readResult<T>(response: Response): Promise<ApiResult<T>> {
    let body: unknown;
    try {
        body = await readJson(response);
    } catch (error) {
        // The answer began but never finished arriving: the connection dropped partway
        if (isAbort(error)) throw error;
        throw new ApiError(0, NETWORK_ERROR_MESSAGE);
    }

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

/**
 * Make a request to the API.
 *
 * @param path - An API path, such as "/api/recipes?search=chili".
 * @returns The parsed body with its `ETag` and `X-Total-Count`.
 * @throws ApiError for an error response or no response; an aborted request
 *         rethrows the browser's AbortError, which TanStack Query expects.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    return readResult<T>(await send(path, options));
}

/** A conditional GET's answer: new data, or word that the copy you have is still current. */
export type IfChangedResult<T> = { changed: false } | ({ changed: true } & ApiResult<T>);

/**
 * GET a resource unless it still has the ETag of the copy you hold.
 *
 * @param etag - The ETag of the copy you hold, sent as `If-None-Match`; null to fetch it whatever it is.
 * @throws ApiError, as `apiRequest()` does.
 */
export async function apiRequestIfChanged<T>(path: string, etag: string | null): Promise<IfChangedResult<T>> {
    const response = await send(path, { ifNoneMatch: etag });
    if (response.status === 304 && etag) return { changed: false };
    return { changed: true, ...(await readResult<T>(response)) };
}
