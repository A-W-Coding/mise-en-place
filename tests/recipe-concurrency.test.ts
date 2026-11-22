/**
 * @module tests/recipe-concurrency.test
 * Integration tests for recipe ETags and If-Match (F3).
 *
 * Each test backdates the seeded recipe first, so the ETag it starts from
 * can't equal one made by a PATCH in the same millisecond.
 */

import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

/** The seeded Beef Chili, with updatedAt moved to a fixed past time. */
async function backdatedChili() {
    const { id } = await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
    return prisma.recipe.update({ where: { id }, data: { updatedAt: new Date('2026-01-01T00:00:00.000Z') } });
}

/** The ETag GET /api/recipes/:id currently returns. */
async function etagOf(id: string): Promise<string> {
    const response = await request.get(`/api/recipes/${id}`);
    expect(response.status).toBe(200);
    return response.headers.etag;
}

describe('Recipe ETags and If-Match', () => {
    setupTestLifecycle();

    describe('ETag', () => {
        test('GET returns a strong ETag made from updatedAt', async () => {
            const chili = await backdatedChili();

            expect(await etagOf(chili.id)).toBe(`"${chili.updatedAt.getTime()}"`);
        });

        test('POST returns the new recipe\'s ETag', async () => {
            const response = await request.post('/api/recipes').send({ name: 'Toast' });

            expect(response.status).toBe(201);
            expect(response.headers.etag).toBe(`"${new Date(response.body.updatedAt).getTime()}"`);
        });

        test('PATCH returns a new ETag, even when only the lines change', async () => {
            const chili = await backdatedChili();
            const before = await etagOf(chili.id);

            const response = await request.patch(`/api/recipes/${chili.id}`).send({ ingredients: [] });

            expect(response.status).toBe(200);
            expect(response.headers.etag).not.toBe(before);
            expect(response.headers.etag).toBe(await etagOf(chili.id));
        });
    });

    describe('PATCH with If-Match', () => {
        test('updates when If-Match is the current ETag', async () => {
            const chili = await backdatedChili();
            const etag = await etagOf(chili.id);

            const response = await request.patch(`/api/recipes/${chili.id}`).set('If-Match', etag).send({ name: 'Chili' });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Chili');
        });

        test('returns 412 and changes nothing when the recipe changed elsewhere', async () => {
            const chili = await backdatedChili();
            const staleEtag = await etagOf(chili.id);
            await request.patch(`/api/recipes/${chili.id}`).send({ servings: 6 }); // the other device's edit

            const response = await request
                .patch(`/api/recipes/${chili.id}`)
                .set('If-Match', staleEtag)
                .send({ name: 'Overwritten' });

            expect(response.status).toBe(412);
            expect(response.body).toEqual({ error: 'The recipe has changed since it was loaded.' });
            const stored = await prisma.recipe.findUniqueOrThrow({ where: { id: chili.id } });
            expect(stored.name).toBe('Beef Chili');
            expect(stored.servings).toBe(6);
        });

        test('accepts a list of ETags when one of them is current', async () => {
            const chili = await backdatedChili();
            const etag = await etagOf(chili.id);

            const response = await request
                .patch(`/api/recipes/${chili.id}`)
                .set('If-Match', `"1", ${etag}`)
                .send({ name: 'Chili' });

            expect(response.status).toBe(200);
        });

        test('updates with If-Match: *', async () => {
            const chili = await backdatedChili();

            const response = await request.patch(`/api/recipes/${chili.id}`).set('If-Match', '*').send({ name: 'Chili' });

            expect(response.status).toBe(200);
        });

        test('returns 412 for a weak ETag, because If-Match needs a strong match', async () => {
            const chili = await backdatedChili();
            const etag = await etagOf(chili.id);

            const response = await request.patch(`/api/recipes/${chili.id}`).set('If-Match', `W/${etag}`).send({ name: 'Chili' });

            expect(response.status).toBe(412);
        });

        test('updates without If-Match, so curl and scripts still work', async () => {
            const chili = await backdatedChili();

            const response = await request.patch(`/api/recipes/${chili.id}`).send({ name: 'Chili' });

            expect(response.status).toBe(200);
        });

        test('returns 404, not 412, for a recipe that does not exist', async () => {
            const response = await request.patch(`/api/recipes/${randomUUID()}`).set('If-Match', '"1"').send({ name: 'Chili' });

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ error: 'Recipe not found.' });
        });

        test('still validates the body first', async () => {
            const chili = await backdatedChili();

            const response = await request.patch(`/api/recipes/${chili.id}`).set('If-Match', '"1"').send({ servings: -1 });

            expect(response.status).toBe(400);
        });
    });

    describe('DELETE with If-Match', () => {
        test('deletes when If-Match is the current ETag', async () => {
            const chili = await backdatedChili();
            const etag = await etagOf(chili.id);

            const response = await request.delete(`/api/recipes/${chili.id}`).set('If-Match', etag);

            expect(response.status).toBe(200);
            expect(await prisma.recipe.count({ where: { id: chili.id } })).toBe(0);
        });

        test('returns 412 and keeps the recipe when it changed elsewhere', async () => {
            const chili = await backdatedChili();
            const staleEtag = await etagOf(chili.id);
            await request.patch(`/api/recipes/${chili.id}`).send({ servings: 6 });

            const response = await request.delete(`/api/recipes/${chili.id}`).set('If-Match', staleEtag);

            expect(response.status).toBe(412);
            expect(await prisma.recipe.count({ where: { id: chili.id } })).toBe(1);
        });

        test('returns 404 for a recipe that does not exist', async () => {
            const response = await request.delete(`/api/recipes/${randomUUID()}`).set('If-Match', '"1"');

            expect(response.status).toBe(404);
        });
    });
});
