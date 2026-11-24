/**
 * @module tests/sync.test
 * Integration tests for the snapshot, `GET /api/sync` (Phase 3c, D8), and
 * for the gzip compression that covers it and every other response.
 */

import supertest from 'supertest';
import { createHash } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { noneMatch, snapshotEtag } from '../src/routes/sync.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

/** The current snapshot's ETag. */
async function currentEtag(): Promise<string> {
    const response = await request.get('/api/sync');
    expect(response.status).toBe(200);
    return response.headers.etag;
}

/** The seeded Beef Chili. */
function beefChili() {
    return prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
}

describe('GET /api/sync', () => {
    setupTestLifecycle();

    describe('the snapshot', () => {
        test('holds every recipe as GET /api/recipes/:id returns it, sorted by name', async () => {
            await request.post('/api/recipes').send({ name: 'Zucchini Bake' });
            await request.post('/api/recipes').send({ name: 'Apple Crumble' });

            const response = await request.get('/api/sync');

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toMatch(/^application\/json/);
            expect(Object.keys(response.body)).toEqual(['recipes', 'ingredients']);
            expect(response.body.recipes.map((recipe: { name: string }) => recipe.name)).toEqual([
                'Apple Crumble',
                'Beef Chili',
                'Zucchini Bake',
            ]);
            for (const recipe of response.body.recipes) {
                const single = await request.get(`/api/recipes/${recipe.id}`);
                expect(recipe).toEqual(single.body);
            }
        });

        test('keeps each recipe\'s lines in recipe order', async () => {
            const response = await request.get('/api/sync');

            const chili = response.body.recipes.find((recipe: { name: string }) => recipe.name === 'Beef Chili');
            const order = chili.recipeIngredients.map((line: { orderIndex: number }) => line.orderIndex);
            expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        });

        test('holds every ingredient, sorted by name', async () => {
            const response = await request.get('/api/sync');

            const expected = await prisma.ingredient.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
            expect(response.body.ingredients).toHaveLength(12);
            expect(response.body.ingredients).toEqual(JSON.parse(JSON.stringify(expected)));
        });

        test('leaves out a recipe deleted since the last one', async () => {
            const chili = await beefChili();
            await request.delete(`/api/recipes/${chili.id}`);

            const response = await request.get('/api/sync');

            expect(response.body.recipes).toEqual([]);
        });
    });

    describe('its ETag', () => {
        test('is the same, with the same bytes, while nothing changes', async () => {
            const first = await request.get('/api/sync');
            const second = await request.get('/api/sync');

            expect(second.text).toBe(first.text);
            expect(second.headers.etag).toBe(first.headers.etag);
        });

        test('is the quoted SHA-256 of the body, in base64url', async () => {
            const response = await request.get('/api/sync');

            const hash = createHash('sha256').update(response.text).digest('base64url');
            expect(response.headers.etag).toBe(`"${hash}"`);
            expect(response.headers.etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
        });

        test.each([
            ['a new recipe', () => request.post('/api/recipes').send({ name: 'Toast' })],
            ['an edit', async () => request.patch(`/api/recipes/${(await beefChili()).id}`).send({ servings: 6 })],
            ['a delete', async () => request.delete(`/api/recipes/${(await beefChili()).id}`)],
            ['a new ingredient', () => request.post('/api/ingredients').send({ name: 'paprika' })],
            [
                'an ingredient rename',
                async () => {
                    const onion = await prisma.ingredient.findUniqueOrThrow({ where: { name: 'onion' } });
                    return request.patch(`/api/ingredients/${onion.id}`).send({ name: 'red onion' });
                },
            ],
        ])('changes after %s', async (_label, change) => {
            const before = await currentEtag();

            const response = await change();
            expect(response.status).toBeLessThan(300);

            expect(await currentEtag()).not.toBe(before);
        });

        test('is sent with Cache-Control: no-cache, so caches check before reusing a copy', async () => {
            const response = await request.get('/api/sync');

            expect(response.headers['cache-control']).toBe('no-cache');
        });
    });

    describe('If-None-Match', () => {
        test('gets a 304 with no body when it names the current snapshot', async () => {
            const etag = await currentEtag();

            const response = await request.get('/api/sync').set('If-None-Match', etag);

            expect(response.status).toBe(304);
            expect(response.text).toBe('');
            expect(response.headers.etag).toBe(etag);
        });

        test.each([
            ['a weak form of the current ETag', (etag: string) => `W/${etag}`],
            ['a list that includes it', (etag: string) => `"older", ${etag}`],
            ['*', () => '*'],
        ])('gets a 304 for %s', async (_label, header) => {
            const etag = await currentEtag();

            const response = await request.get('/api/sync').set('If-None-Match', header(etag));

            expect(response.status).toBe(304);
        });

        test('gets the new snapshot when it names an older one', async () => {
            const old = await currentEtag();
            await request.post('/api/recipes').send({ name: 'Toast' });

            const response = await request.get('/api/sync').set('If-None-Match', old);

            expect(response.status).toBe(200);
            expect(response.headers.etag).not.toBe(old);
            expect(response.body.recipes.map((recipe: { name: string }) => recipe.name)).toContain('Toast');
        });
    });

    describe('compression', () => {
        test('gzips the snapshot when the request accepts it', async () => {
            const plain = await request.get('/api/sync').set('Accept-Encoding', 'identity');
            const gzipped = await request.get('/api/sync').set('Accept-Encoding', 'gzip');

            expect(plain.headers['content-encoding']).toBeUndefined();
            expect(gzipped.headers['content-encoding']).toBe('gzip');
            expect(gzipped.headers.vary).toMatch(/Accept-Encoding/);
            // Supertest unzips it: the same snapshot, and the same ETag
            expect(gzipped.text).toBe(plain.text);
            expect(gzipped.headers.etag).toBe(plain.headers.etag);
        });

        test('leaves a small response as it is', async () => {
            const response = await request.get('/api/health').set('Accept-Encoding', 'gzip');

            expect(response.status).toBe(200);
            expect(response.headers['content-encoding']).toBeUndefined();
        });
    });
});

describe('snapshotEtag and noneMatch', () => {
    const etag = snapshotEtag('{"recipes":[],"ingredients":[]}');

    test('the same body always gives the same ETag, and another body another', () => {
        expect(snapshotEtag('{"recipes":[],"ingredients":[]}')).toBe(etag);
        expect(snapshotEtag('{"recipes":[],"ingredients":[{}]}')).not.toBe(etag);
    });

    test.each([
        ['no header', undefined, false],
        ['the ETag', etag, true],
        ['its weak form', `W/${etag}`, true],
        ['a list with it, spaced oddly', `"a",${etag} , "b"`, true],
        ['*', '*', true],
        ['another ETag', '"something-else"', false],
        ['the ETag without its quotes', etag.slice(1, -1), false],
    ])('If-None-Match with %s matches: %s', (_label, header, expected) => {
        expect(noneMatch(header, etag)).toBe(expected);
    });
});
