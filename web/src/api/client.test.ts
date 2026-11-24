import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, NETWORK_ERROR_MESSAGE, apiRequest, apiRequestIfChanged } from './client';

/** Make `fetch` answer once with this status, body and headers. */
function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const fetchMock = vi.fn().mockResolvedValue(new Response(status === 204 ? null : text, { status, headers }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** The ApiError a request throws. */
async function errorFrom(promise: Promise<unknown>): Promise<ApiError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof ApiError) return error;
        throw error;
    }
    throw new Error('Expected the request to fail.');
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('apiRequest', () => {
    test('returns the body, the ETag and the list total', async () => {
        answer(200, [{ id: 'a' }], { ETag: '"1700000000000"', 'X-Total-Count': '23' });

        const result = await apiRequest<{ id: string }[]>('/api/recipes');

        expect(result).toEqual({ data: [{ id: 'a' }], etag: '"1700000000000"', totalCount: 23 });
    });

    test('returns null for headers that are absent', async () => {
        answer(200, { status: 'ok' });

        const result = await apiRequest('/api/health');

        expect(result.etag).toBeNull();
        expect(result.totalCount).toBeNull();
    });

    test('sends a body as JSON, with its content type', async () => {
        const fetchMock = answer(201, { id: 'b' });

        await apiRequest('/api/recipes', { method: 'POST', body: { name: 'Toast' } });

        const [path, init] = fetchMock.mock.calls[0];
        expect(path).toBe('/api/recipes');
        expect(init.method).toBe('POST');
        expect(init.body).toBe('{"name":"Toast"}');
        expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
    });

    test("never uses the browser's HTTP cache, which Firefox would answer from when offline", async () => {
        const fetchMock = answer(200, []);
        await apiRequest('/api/recipes');
        expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');

        const write = answer(201, {});
        await apiRequest('/api/recipes', { method: 'POST', body: { name: 'Toast' } });
        expect(write.mock.calls[0][1].cache).toBe('no-store');
    });

    test('sends If-Match when given an ETag, and nothing otherwise', async () => {
        const fetchMock = answer(200, {});
        await apiRequest('/api/recipes/x', { method: 'PATCH', body: {}, ifMatch: '"5"' });
        expect(fetchMock.mock.calls[0][1].headers['If-Match']).toBe('"5"');

        const second = answer(200, {});
        await apiRequest('/api/recipes/x', { method: 'PATCH', body: {}, ifMatch: null });
        expect(second.mock.calls[0][1].headers).not.toHaveProperty('If-Match');
    });

    test("turns a 400 into an ApiError with the API's per-field messages", async () => {
        answer(400, { error: 'Validation failed.', fields: { name: 'Must not be empty.', 'ingredients.0.unit': 'Unknown unit.' } });

        const error = await errorFrom(apiRequest('/api/recipes', { method: 'POST', body: {} }));

        expect(error.status).toBe(400);
        expect(error.message).toBe('Validation failed.');
        expect(error.fields).toEqual({ name: 'Must not be empty.', 'ingredients.0.unit': 'Unknown unit.' });
        expect(error.isNetworkError).toBe(false);
    });

    test("keeps the API's message for other errors, such as a 412", async () => {
        answer(412, { error: 'The recipe has changed since it was loaded.' });

        const error = await errorFrom(apiRequest('/api/recipes/x', { method: 'PATCH', body: {}, ifMatch: '"1"' }));

        expect(error.status).toBe(412);
        expect(error.message).toBe('The recipe has changed since it was loaded.');
        expect(error.fields).toEqual({});
    });

    test('gives a plain message when an error has no JSON body', async () => {
        answer(500, '<html>Internal error</html>');

        const error = await errorFrom(apiRequest('/api/recipes'));

        expect(error.status).toBe(500);
        expect(error.message).toBe('The request failed (500).');
    });

    test.each([502, 504])('treats a %i with no JSON body as the server being unreachable', async (status) => {
        answer(status, '<html>Bad gateway</html>');

        const error = await errorFrom(apiRequest('/api/recipes'));

        expect(error.status).toBe(status);
        expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
        expect(error.isNetworkError).toBe(true);
    });

    test('turns no response at all into a network error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        const error = await errorFrom(apiRequest('/api/recipes'));

        expect(error.status).toBe(0);
        expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
        expect(error.isNetworkError).toBe(true);
    });

    test('lets an aborted request through unchanged, for TanStack Query', async () => {
        const abort = new DOMException('The operation was aborted.', 'AbortError');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

        await expect(apiRequest('/api/recipes')).rejects.toBe(abort);
    });

    test('accepts an empty body', async () => {
        answer(204, '');

        const result = await apiRequest('/api/recipes/x', { method: 'DELETE' });

        expect(result.data).toBeNull();
    });

    test('turns an answer cut off partway into a network error', async () => {
        // The headers arrived, then the connection dropped during the body
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"recipes": ['));
                controller.error(new TypeError('network error'));
            },
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

        const error = await errorFrom(apiRequest('/api/sync'));

        expect(error.status).toBe(0);
        expect(error.isNetworkError).toBe(true);
    });
});

describe('apiRequestIfChanged', () => {
    test('sends the ETag held as If-None-Match, and a 304 means it is still current', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"abc"' } }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await apiRequestIfChanged('/api/sync', '"abc"');

        expect(result).toEqual({ changed: false });
        const [path, init] = fetchMock.mock.calls[0];
        expect(path).toBe('/api/sync');
        expect(init.headers['If-None-Match']).toBe('"abc"');
    });

    test('returns the new data and its ETag when it changed', async () => {
        answer(200, { recipes: [], ingredients: [] }, { ETag: '"def"' });

        const result = await apiRequestIfChanged('/api/sync', '"abc"');

        expect(result).toEqual({ changed: true, data: { recipes: [], ingredients: [] }, etag: '"def"', totalCount: null });
    });

    test('sends no If-None-Match when no copy is held', async () => {
        const fetchMock = answer(200, { recipes: [], ingredients: [] });

        await apiRequestIfChanged('/api/sync', null);

        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('If-None-Match');
    });

    test('fails as apiRequest does', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        expect((await errorFrom(apiRequestIfChanged('/api/sync', '"abc"'))).isNetworkError).toBe(true);

        answer(500, { error: 'Something went wrong.' });
        expect((await errorFrom(apiRequestIfChanged('/api/sync', '"abc"'))).status).toBe(500);
    });
});
