/**
 * @module web/src/test/renderApp
 * Render the whole app at an address, as a deep link would, against a fake API.
 *
 * `mockApi()` replaces `fetch` with a table of routes, so a component test
 * runs the real pages, router, TanStack Query and API module, and only the
 * network is pretend.
 */

import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter, type InitialEntry } from 'react-router';
import { vi } from 'vitest';
import { routes } from '../routes';

/** A JSON response, as the API sends it. */
export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...init.headers },
    });
}

/** A list page, with its `X-Total-Count`. */
export function page<T>(items: T[], total = items.length): Response {
    return json(items, { headers: { 'X-Total-Count': String(total) } });
}

/** What the browser does when the server can't be reached. */
export function unreachable(): never {
    throw new TypeError('Failed to fetch');
}

type Responder = Response | ((url: URL, init: RequestInit) => Response | Promise<Response>);

/**
 * Replace `fetch` with fake API routes, matched in order by method and path
 * (a string for an exact path, or a RegExp). Unmatched requests get the API's
 * JSON 404. Returns the mock, so tests can check what was asked for.
 */
export function mockApi(routes: [method: string, path: string | RegExp, respond: Responder][]) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost');
        const method = init?.method ?? 'GET';
        const route = routes.find(
            ([routeMethod, path]) =>
                routeMethod === method && (typeof path === 'string' ? url.pathname === path : path.test(url.pathname)),
        );
        if (!route) return json({ error: 'Not found.' }, { status: 404 });
        const respond = route[2];
        // A Response body can only be read once, so a fixed one is cloned for each request
        return typeof respond === 'function' ? respond(url, init ?? {}) : respond.clone();
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** The URLs of every request made so far. */
export function requestedUrls(fetchMock: ReturnType<typeof mockApi>): URL[] {
    return fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost'));
}

export interface SentRequest {
    method: string;
    path: string;
    body: unknown;
    headers: Record<string, string>;
}

/** Every request with a given method, with its parsed JSON body and headers: what a write sent. */
export function sent(fetchMock: ReturnType<typeof mockApi>, method: string): SentRequest[] {
    return fetchMock.mock.calls
        .map(([input, init]) => ({
            method: init?.method ?? 'GET',
            path: new URL(String(input), 'http://localhost').pathname,
            body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
            headers: (init?.headers ?? {}) as Record<string, string>,
        }))
        .filter((request) => request.method === method);
}

export function renderApp(entry: InitialEntry) {
    // No retries, so a failure shows at once
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: [entry] });
    const user = userEvent.setup();
    render(
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
    return { router, queryClient, user };
}
