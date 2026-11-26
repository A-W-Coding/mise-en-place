/**
 * @module src/middleware/media
 * Serves the image files under `/media` (3b; technical spec §3.2): only
 * names the API makes, `<uuid>.webp` and `<uuid>-thumb.webp`, from
 * `MEDIA_DIR`. A file's contents never change, since a new upload gets a new
 * id, so each is cached for a year as `immutable`. Anything else under
 * `/media` falls through to a plain 404.
 */

import express, { type RequestHandler } from 'express';
import { mediaDir } from '../utils/media.js';

/** The only names under /media: an image's id, then `.webp` or `-thumb.webp`. */
const IMAGE_FILE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-thumb)?\.webp$/;

export function mediaFiles(dir = mediaDir()): RequestHandler {
    const files = express.static(dir, {
        immutable: true,
        maxAge: '1y',
        index: false,
        redirect: false,
        dotfiles: 'deny',
        // A browser mustn't guess the type of anything served from here
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    });
    return (req, res, next) => (IMAGE_FILE.test(req.path) ? files(req, res, next) : next());
}
