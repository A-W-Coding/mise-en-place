/**
 * @module tests/cors.test
 * Tests for the CORS policy (S1).
 *
 * The real app reads CORS_ORIGINS once, when it's imported, so these
 * tests mount `corsPolicy()` on a tiny Express app with the origins
 * passed in directly.
 */

import express from 'express';
import supertest from 'supertest';
import { corsPolicy, parseCorsOrigins } from '../src/middleware/cors.js';

/** A one-route app behind the CORS policy, for the given allowed origins. */
function appAllowing(origins: string[]) {
    const app = express();
    app.use(corsPolicy(origins));
    app.get('/things', (_req, res) => {
        res.set('X-Total-Count', '0').json([]);
    });
    return supertest(app);
}

describe('parseCorsOrigins', () => {
    test.each([
        [undefined, []],
        ['', []],
        [' , ,', []],
        ['http://localhost:5173', ['http://localhost:5173']],
        [' http://localhost:5173/ , https://a.example ', ['http://localhost:5173', 'https://a.example']],
    ])('parses %j as %j', (value, expected) => {
        expect(parseCorsOrigins(value)).toEqual(expected);
    });
});

describe('corsPolicy', () => {
    test('should let an allowed origin read responses and X-Total-Count', async () => {
        const response = await appAllowing(['https://a.example'])
            .get('/things')
            .set('Origin', 'https://a.example');

        expect(response.headers['access-control-allow-origin']).toBe('https://a.example');
        expect(response.headers['access-control-expose-headers']).toBe('X-Total-Count');
    });

    test('should not allow any other origin', async () => {
        const response = await appAllowing(['https://a.example'])
            .get('/things')
            .set('Origin', 'https://evil.example');

        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('should allow no origin at all when none are configured', async () => {
        const response = await appAllowing([]).get('/things').set('Origin', 'https://a.example');

        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.headers['access-control-expose-headers']).toBeUndefined();
    });

    test('should answer a preflight from an allowed origin', async () => {
        const response = await appAllowing(['https://a.example'])
            .options('/things')
            .set('Origin', 'https://a.example')
            .set('Access-Control-Request-Method', 'PATCH');

        expect(response.status).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe('https://a.example');
        expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    });
});
