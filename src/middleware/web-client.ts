/**
 * @module src/middleware/web-client
 * Serves the built web client from the same origin as the API (F1).
 *
 * - `/assets/*`: Vite's build output. Each file name carries a hash of its
 *   contents, so a file never changes and is cached for a year.
 * - Other files in the build (the favicon, and later the manifest and the
 *   service worker): always revalidated, so a deploy reaches every device on
 *   its next visit.
 * - Any other GET for a page (not under `/api` or `/media`, no file
 *   extension, accepts HTML) gets `index.html`, revalidated too, so a deep
 *   link such as `/recipes/<id>` loads the app and the client routes it.
 *
 * Everything else falls through: unknown `/api` paths get their JSON 404,
 * and a missing asset gets a 404 instead of the app's HTML.
 */

import { existsSync } from 'fs';
import path from 'path';
import express, { Router } from 'express';

/** Where the built client is: `WEB_DIST_DIR`, or `web/dist` under the working directory. */
export function webDistDir(): string {
    return path.resolve(process.env.WEB_DIST_DIR ?? 'web/dist');
}

/** Requests the client app handles rather than the API or the media store. */
function isAppPath(urlPath: string): boolean {
    return !/^\/(api|media)(\/|$)/.test(urlPath) && path.extname(urlPath) === '';
}

/**
 * Build the router that serves the client.
 *
 * @param distDir - The built client (Vite's `dist`). If it doesn't exist, as
 *                  when only the API is being developed or tested, every
 *                  request falls through.
 */
export function webClient(distDir: string): Router {
    const router = Router();
    const indexFile = path.join(distDir, 'index.html');

    router.use(
        '/assets',
        express.static(path.join(distDir, 'assets'), { index: false, immutable: true, maxAge: '1y' }),
    );
    router.use(
        express.static(distDir, {
            index: false,
            setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
        }),
    );
    router.use((req, res, next) => {
        const isRead = req.method === 'GET' || req.method === 'HEAD';
        if (!isRead || !isAppPath(req.path) || !req.accepts('html') || !existsSync(indexFile)) {
            next();
            return;
        }
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
    });

    return router;
}
