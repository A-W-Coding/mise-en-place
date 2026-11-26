/**
 * @module src/utils/media
 * Where image files are kept, and writing and removing them (3b, D11).
 *
 * Each image is two WebP files named after its row's UUID:
 * `<id>.webp` (at most 2,000 px on its longest side) and `<id>-thumb.webp`
 * (400 px). Nothing from an upload's own file name is ever used. The folder
 * is `MEDIA_DIR`, or `media` under the working directory; on the Pi it's a
 * Docker volume mounted at `/app/media`.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

/** The folder the image files live in, read when it's needed, so tests can point it elsewhere. */
export function mediaDir(): string {
    return resolve(process.env.MEDIA_DIR || 'media');
}

/** An image's two file names, as served under `/media`. */
export function imageFileNames(id: string): { full: string; thumb: string } {
    return { full: `${id}.webp`, thumb: `${id}-thumb.webp` };
}

/**
 * Write an image's two files. If either fails, neither is left behind.
 *
 * @throws The file system's error, after cleaning up.
 */
export async function writeImageFiles(id: string, full: Buffer, thumb: Buffer): Promise<void> {
    const dir = mediaDir();
    const names = imageFileNames(id);
    await mkdir(dir, { recursive: true });
    try {
        await writeFile(join(dir, names.full), full, { flag: 'wx' });
        await writeFile(join(dir, names.thumb), thumb, { flag: 'wx' });
    } catch (error) {
        await removeImageFiles([id]);
        throw error;
    }
}

/**
 * Remove images' files. A file that's already gone is fine; any other
 * problem is logged rather than thrown, since the row it belonged to has
 * gone and nothing reads the file any more.
 */
export async function removeImageFiles(ids: string[]): Promise<void> {
    const dir = mediaDir();
    for (const id of ids) {
        const names = imageFileNames(id);
        for (const name of [names.full, names.thumb]) {
            try {
                await rm(join(dir, name), { force: true });
            } catch (error) {
                console.error(`[media] Couldn't remove ${name}:`, error);
            }
        }
    }
}
