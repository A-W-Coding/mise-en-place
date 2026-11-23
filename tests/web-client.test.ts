/**
 * @module tests/web-client.test
 * Unit tests for serving the built web client (F1).
 *
 * The router is mounted on a small app pointed at a fixture build in
 * tests/fixtures/web-client, so these don't depend on web/dist existing.
 */

import path from 'path';
import express from 'express';
import supertest from 'supertest';
import { webClient, webDistDir } from '../src/middleware/web-client.js';

const FIXTURE = path.resolve('tests/fixtures/web-client');

/** An app with the client router, and a JSON 404 under /api like the real one. */
function appServing(distDir: string) {
    const app = express();
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'Not found.' });
    });
    app.use(webClient(distDir));
    return supertest(app);
}

describe('webClient', () => {
    const request = appServing(FIXTURE);

    test('serves hashed build files, cached for a year', async () => {
        const response = await request.get('/assets/index-3f9a1c2b.js');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/javascript/);
        expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });

    test('serves other build files, always revalidated', async () => {
        const response = await request.get('/favicon.svg');

        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-cache');
    });

    test.each(['/', '/recipes/2c7a9e4e-1d3f-4b5a-9c8d-7e6f5a4b3c2d', '/recipes/new', '/options/ingredients'])(
        'serves index.html for the page %s, always revalidated',
        async (pagePath) => {
            const response = await request.get(pagePath).set('Accept', 'text/html');

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toMatch(/^text\/html/);
            expect(response.headers['cache-control']).toBe('no-cache');
            expect(response.text).toContain('<div id="root">');
        },
    );

    test('leaves unknown /api paths to their JSON 404', async () => {
        const response = await request.get('/api/nothing-here').set('Accept', 'text/html');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Not found.' });
    });

    test('leaves /media paths alone', async () => {
        const response = await request.get('/media/2c7a9e4e').set('Accept', 'text/html');

        expect(response.status).toBe(404);
        expect(response.text).not.toContain('<div id="root">');
    });

    test('gives a missing asset a 404, not the app', async () => {
        const response = await request.get('/assets/index-00000000.js').set('Accept', '*/*');

        expect(response.status).toBe(404);
        expect(response.text).not.toContain('<div id="root">');
    });

    test("doesn't answer a request that only accepts JSON with the app", async () => {
        const response = await request.get('/recipes/abc').set('Accept', 'application/json');

        expect(response.status).toBe(404);
    });

    test("doesn't answer writes with the app", async () => {
        const response = await request.post('/recipes').set('Accept', 'text/html');

        expect(response.status).toBe(404);
    });

    test('lets every request through when there is no build', async () => {
        const response = await appServing(path.join(FIXTURE, 'missing')).get('/').set('Accept', 'text/html');

        expect(response.status).toBe(404);
    });
});

describe('webDistDir', () => {
    const saved = process.env.WEB_DIST_DIR;
    afterEach(() => {
        if (saved === undefined) delete process.env.WEB_DIST_DIR;
        else process.env.WEB_DIST_DIR = saved;
    });

    test('defaults to web/dist under the working directory', () => {
        delete process.env.WEB_DIST_DIR;
        expect(webDistDir()).toBe(path.resolve('web/dist'));
    });

    test('follows WEB_DIST_DIR', () => {
        process.env.WEB_DIST_DIR = 'somewhere/else';
        expect(webDistDir()).toBe(path.resolve('somewhere/else'));
    });
});
