/**
 * @module tests/tags-api.test
 * The Tag endpoints (3b, spec §3.2): a shared list like ingredients, with
 * normalised unique names, an optional `#rrggbb` colour, and each tag's
 * `recipeCount`. Deleting a tag takes it off every recipe.
 */

import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

async function createTag(name: string, color?: string | null) {
    const response = await request.post('/api/tags').send(color === undefined ? { name } : { name, color });
    expect(response.status).toBe(201);
    return response.body as { id: string; name: string; color: string | null; recipeCount: number };
}

/** Put tags on the seeded Beef Chili, in this order. */
async function tagBeefChili(tagIds: string[]) {
    const chili = await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
    const response = await request.patch(`/api/recipes/${chili.id}`).send({ tagIds });
    expect(response.status).toBe(200);
    return chili.id;
}

describe('Tag API', () => {
    setupTestLifecycle();

    describe('POST /api/tags', () => {
        test('stores the name trimmed and lowercase, and the colour lowercase', async () => {
            const response = await request.post('/api/tags').send({ name: '  Weeknight ', color: '#1F4E79' });

            expect(response.status).toBe(201);
            expect(response.body).toEqual({
                id: expect.any(String),
                name: 'weeknight',
                color: '#1f4e79',
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
                recipeCount: 0,
            });
        });

        test('a tag needs no colour', async () => {
            expect(await createTag('dessert')).toMatchObject({ name: 'dessert', color: null });
            expect(await createTag('spicy', null)).toMatchObject({ color: null });
        });

        test('refuses a name that is taken, whatever its case', async () => {
            await createTag('dessert');

            const response = await request.post('/api/tags').send({ name: 'DESSERT ' });

            expect(response.status).toBe(409);
            expect(response.body).toEqual({ error: 'That name already exists.' });
        });

        test.each([
            [{}, 'name', 'Required.'],
            [{ name: '   ' }, 'name', 'Must not be empty.'],
            [{ name: 'x'.repeat(51) }, 'name', 'Must be at most 50 characters.'],
            [{ name: 'a', color: 'green' }, 'color', 'Must be a colour like #1f7a5c, or null.'],
            [{ name: 'a', color: '#fff' }, 'color', 'Must be a colour like #1f7a5c, or null.'],
            [{ name: 'a', color: 12 }, 'color', 'Must be a colour like #1f7a5c, or null.'],
        ])('refuses %j (%s)', async (body, field, message) => {
            const response = await request.post('/api/tags').send(body);

            expect(response.status).toBe(400);
            expect(response.body.fields).toEqual({ [field]: message });
        });

        test('refuses unknown fields', async () => {
            const response = await request.post('/api/tags').send({ name: 'a', recipeCount: 5 });

            expect(response.status).toBe(400);
        });
    });

    describe('GET /api/tags', () => {
        test('lists every tag by name, each with how many recipes use it', async () => {
            const spicy = await createTag('spicy', '#ffd8c2');
            const beef = await createTag('beef', '#f6c7bd');
            await createTag('dessert');
            await tagBeefChili([spicy.id, beef.id]);

            const response = await request.get('/api/tags');

            expect(response.status).toBe(200);
            expect(response.headers['x-total-count']).toBe('3');
            expect(response.body.map((tag: { name: string; recipeCount: number }) => [tag.name, tag.recipeCount])).toEqual([
                ['beef', 1],
                ['dessert', 0],
                ['spicy', 1],
            ]);
        });

        test('pages, and searches fuzzily, as the other lists do', async () => {
            for (const name of ['weeknight', 'weekend', 'vegetarian', 'dessert']) await createTag(name);

            const page = await request.get('/api/tags?limit=2&offset=1');
            const search = await request.get('/api/tags?search=week');
            const typo = await request.get('/api/tags?search=vegtarian');

            expect(page.body.map((tag: { name: string }) => tag.name)).toEqual(['vegetarian', 'weekend']);
            expect(page.headers['x-total-count']).toBe('4');
            expect(search.body.map((tag: { name: string }) => tag.name).sort()).toEqual(['weekend', 'weeknight']);
            expect(search.body[0]).toHaveProperty('recipeCount', 0);
            expect(typo.body.map((tag: { name: string }) => tag.name)).toEqual(['vegetarian']);
        });
    });

    describe('GET /api/tags/:id', () => {
        test('returns the tag with its recipe count, or 404', async () => {
            const tag = await createTag('beef');
            await tagBeefChili([tag.id]);

            const found = await request.get(`/api/tags/${tag.id}`);
            const missing = await request.get(`/api/tags/${randomUUID()}`);

            expect(found.body).toMatchObject({ name: 'beef', recipeCount: 1 });
            expect(missing.status).toBe(404);
            expect(missing.body).toEqual({ error: 'Tag not found.' });
        });
    });

    describe('PATCH /api/tags/:id', () => {
        test('renames and recolours, changing only what is sent', async () => {
            const tag = await createTag('beef', '#f6c7bd');

            const renamed = await request.patch(`/api/tags/${tag.id}`).send({ name: 'Red Meat' });
            const recoloured = await request.patch(`/api/tags/${tag.id}`).send({ color: '#C8DDF4' });
            const uncoloured = await request.patch(`/api/tags/${tag.id}`).send({ color: null });

            expect(renamed.body).toMatchObject({ name: 'red meat', color: '#f6c7bd' });
            expect(recoloured.body).toMatchObject({ name: 'red meat', color: '#c8ddf4' });
            expect(uncoloured.body).toMatchObject({ name: 'red meat', color: null, recipeCount: 0 });
        });

        test('a recipe shows the new name and colour', async () => {
            const tag = await createTag('beef', '#f6c7bd');
            const recipeId = await tagBeefChili([tag.id]);

            await request.patch(`/api/tags/${tag.id}`).send({ name: 'red meat', color: '#c8ddf4' });
            const recipe = await request.get(`/api/recipes/${recipeId}`);

            expect(recipe.body.tags[0].tag).toMatchObject({ name: 'red meat', color: '#c8ddf4' });
        });

        test('refuses a taken name with 409, and an unknown tag with 404', async () => {
            await createTag('beef');
            const pork = await createTag('pork');

            const taken = await request.patch(`/api/tags/${pork.id}`).send({ name: 'Beef' });
            const missing = await request.patch(`/api/tags/${randomUUID()}`).send({ name: 'lamb' });

            expect(taken.status).toBe(409);
            expect(missing.status).toBe(404);
        });
    });

    describe('DELETE /api/tags/:id', () => {
        test('takes the tag off every recipe, which keeps its other tags in order', async () => {
            const beef = await createTag('beef');
            const spicy = await createTag('spicy');
            const mexican = await createTag('mexican');
            const recipeId = await tagBeefChili([beef.id, spicy.id, mexican.id]);

            const response = await request.delete(`/api/tags/${spicy.id}`);
            const recipe = await request.get(`/api/recipes/${recipeId}`);

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ message: 'Tag deleted successfully.' });
            expect(recipe.body.tags.map((line: { tag: { name: string } }) => line.tag.name)).toEqual(['beef', 'mexican']);
            expect(await prisma.tag.count()).toBe(2);
        });

        test('a tag that is not there is a 404', async () => {
            const response = await request.delete(`/api/tags/${randomUUID()}`);

            expect(response.status).toBe(404);
        });
    });
});
