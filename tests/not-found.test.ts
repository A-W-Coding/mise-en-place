/**
 * @module tests/not-found.test
 * Unknown paths under /api get a JSON 404, not Express's HTML page.
 */

import supertest from 'supertest';
import { app } from '../src/app.js';

const request = supertest(app);

describe('Unknown API paths', () => {
    test.each([
        ['GET', '/api'],
        ['GET', '/api/nothing-here'],
        ['GET', '/api/recipes/some-id/extra'],
        ['POST', '/api/nothing-here'],
        ['PUT', '/api/recipes/some-id'],
    ])('%s %s returns 404 { error: "Not found." } as JSON', async (method, path) => {
        const response = await request[method.toLowerCase() as 'get' | 'post' | 'put'](path);

        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body).toEqual({ error: 'Not found.' });
    });
});
