import { afterEach, describe, expect, test, vi } from 'vitest';
import { beefChili, lemonDrizzle, snapshotOf, withPhotos } from '../test/fixtures';
import { cacheThumbnails, IMAGE_CACHE, imageUrl, THUMBNAIL_CACHE, thumbUrl } from './media';

/** A stand-in for the browser's Cache Storage: each cache a map of address to response. */
function fakeCaches() {
    const stores = new Map<string, Map<string, Response>>();
    const open = async (name: string) => {
        const store = stores.get(name) ?? new Map<string, Response>();
        stores.set(name, store);
        const href = (request: RequestInfo | URL) => new URL(String(request instanceof Request ? request.url : request), 'http://localhost').href;
        return {
            keys: async () => [...store.keys()].map((url) => new Request(url)),
            put: async (request: RequestInfo | URL, response: Response) => void store.set(href(request), response),
            delete: async (request: RequestInfo | URL) => store.delete(href(request)),
        };
    };
    vi.stubGlobal('caches', { open });
    const paths = (name: string) => [...(stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname).sort();
    return { open, paths };
}

afterEach(() => vi.unstubAllGlobals());

describe('cacheThumbnails', () => {
    const chili = withPhotos(beefChili, 2);
    const cake = withPhotos(lemonDrizzle, 1);
    const ids = [...chili.images, ...cake.images].map((image) => image.id);

    test("fetches every photo's thumbnail it hasn't got, and only those", async () => {
        const store = fakeCaches();
        const thumbnails = await store.open(THUMBNAIL_CACHE);
        await thumbnails.put(thumbUrl(ids[0]!), new Response('cached'));
        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response('thumbnail'));
        vi.stubGlobal('fetch', fetchMock);

        await cacheThumbnails(snapshotOf([chili, cake]));

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([thumbUrl(ids[1]!), thumbUrl(ids[2]!)]);
        expect(store.paths(THUMBNAIL_CACHE)).toEqual(ids.map(thumbUrl).sort());
    });

    test("drops the files of photos the snapshot no longer has, full ones too", async () => {
        const store = fakeCaches();
        const gone = 'deadbeef-0000-4000-8000-000000000000';
        const thumbnails = await store.open(THUMBNAIL_CACHE);
        const images = await store.open(IMAGE_CACHE);
        await thumbnails.put(thumbUrl(gone), new Response('old'));
        await images.put(imageUrl(gone), new Response('old'));
        await images.put(imageUrl(ids[0]!), new Response('viewed'));
        vi.stubGlobal('fetch', vi.fn(async () => new Response('thumbnail')));

        await cacheThumbnails(snapshotOf([chili, cake]));

        expect(store.paths(THUMBNAIL_CACHE)).not.toContain(thumbUrl(gone));
        expect(store.paths(IMAGE_CACHE)).toEqual([imageUrl(ids[0]!)]);
    });

    test("leaves out a thumbnail that doesn't arrive, to try again after the next refresh", async () => {
        const store = fakeCaches();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url === thumbUrl(ids[1]!)) throw new TypeError('Failed to fetch');
                return url === thumbUrl(ids[2]!) ? new Response('', { status: 404 }) : new Response('thumbnail');
            }),
        );

        await cacheThumbnails(snapshotOf([chili, cake]));

        expect(store.paths(THUMBNAIL_CACHE)).toEqual([thumbUrl(ids[0]!)]);
    });

    test('does nothing where there is no Cache API', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await cacheThumbnails(snapshotOf([chili]));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
