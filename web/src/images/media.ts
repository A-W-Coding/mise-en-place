/**
 * @module web/src/images/media
 * Where a recipe's photos are (3b): each is two WebP files the API serves
 * under `/media`, named after the image's id, a full one and a thumbnail.
 *
 * Offline (technical spec §3.4), the service worker keeps them in two caches:
 * every thumbnail, put there ahead of time by `cacheThumbnails()` after each
 * snapshot refresh, and the full photos you've viewed, the latest 100 (see
 * `vite.config.ts`). The same pass drops the files of photos the snapshot no
 * longer has, so a deleted photo's files don't linger.
 */

import type { Snapshot } from '../offline/copy';

/** The full photo: at most 2,000 px on its longest side. */
export const imageUrl = (id: string) => `/media/${encodeURIComponent(id)}.webp`;
/** The thumbnail: at most 400 px. */
export const thumbUrl = (id: string) => `/media/${encodeURIComponent(id)}-thumb.webp`;

/** The most photos a recipe can have, as the API allows. */
export const MAX_PHOTOS = 10;
/** The biggest file the API takes: 15 MB. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** The service worker's caches for photos; `vite.config.ts` uses the same names. */
export const THUMBNAIL_CACHE = 'mise-en-place-thumbnails';
export const IMAGE_CACHE = 'mise-en-place-images';

/** How many thumbnails to fetch at once: enough to be quick, few enough not to crowd a phone's connection. */
const AT_ONCE = 4;

/** The image id in a cached file's address, or null for anything else. */
function imageIdOf(url: string): string | null {
    const match = /\/media\/([0-9a-f-]+?)(-thumb)?\.webp$/.exec(new URL(url).pathname);
    return match?.[1] ?? null;
}

/**
 * Keep the offline photo caches in step with a snapshot: drop the files of
 * photos it no longer has, then fetch any thumbnail not cached yet. Best
 * effort: a thumbnail that doesn't arrive is tried again after the next
 * refresh, and a browser without the Cache API (or a test) skips it all.
 */
export async function cacheThumbnails(snapshot: Snapshot): Promise<void> {
    if (typeof caches === 'undefined') return;
    const ids = new Set(snapshot.recipes.flatMap((recipe) => recipe.images.map((image) => image.id)));

    const thumbnails = await caches.open(THUMBNAIL_CACHE);
    const images = await caches.open(IMAGE_CACHE);
    for (const cache of [thumbnails, images]) {
        for (const request of await cache.keys()) {
            const id = imageIdOf(request.url);
            if (id === null || !ids.has(id)) await cache.delete(request);
        }
    }

    const cached = new Set((await thumbnails.keys()).map((request) => imageIdOf(request.url)));
    const missing = [...ids].filter((id) => !cached.has(id));
    for (let start = 0; start < missing.length; start += AT_ONCE) {
        await Promise.all(
            missing.slice(start, start + AT_ONCE).map(async (id) => {
                try {
                    const response = await fetch(thumbUrl(id));
                    if (response.ok) await thumbnails.put(thumbUrl(id), response);
                } catch {
                    // Offline again, or gone meanwhile: the next refresh tries again
                }
            }),
        );
    }
}
