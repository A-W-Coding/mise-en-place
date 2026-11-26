/**
 * @module tests/equipment-api.test
 * The Equipment endpoints (3b, spec §3.2): a shared list managed exactly
 * like ingredients, whose items can't be deleted while a recipe uses them.
 */

import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

async function createItem(name: string) {
    const response = await request.post('/api/equipment').send({ name });
    expect(response.status).toBe(201);
    return response.body as { id: string; name: string };
}

describe('Equipment API', () => {
    setupTestLifecycle();

    test('creates an item with its name trimmed and lowercase, and refuses a taken one', async () => {
        const created = await request.post('/api/equipment').send({ name: ' Dutch Oven ' });
        const taken = await request.post('/api/equipment').send({ name: 'dutch oven' });

        expect(created.status).toBe(201);
        expect(created.body).toEqual({
            id: expect.any(String),
            name: 'dutch oven',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
        });
        expect(taken.status).toBe(409);
        expect(taken.body).toEqual({ error: 'That name already exists.' });
    });

    test.each([
        [{}, 'Required.'],
        [{ name: '' }, 'Must not be empty.'],
        [{ name: 'x'.repeat(101) }, 'Must be at most 100 characters.'],
    ])('refuses %j', async (body, message) => {
        const response = await request.post('/api/equipment').send(body);

        expect(response.status).toBe(400);
        expect(response.body.fields).toEqual({ name: message });
    });

    test('lists by name with a total, pages, and searches fuzzily', async () => {
        for (const name of ['wooden spoon', 'saucepan', 'large pan', 'garlic press']) await createItem(name);

        const all = await request.get('/api/equipment');
        const page = await request.get('/api/equipment?limit=1&offset=1');
        const search = await request.get('/api/equipment?search=pan');

        expect(all.body.map((item: { name: string }) => item.name)).toEqual(['garlic press', 'large pan', 'saucepan', 'wooden spoon']);
        expect(all.headers['x-total-count']).toBe('4');
        expect(page.body.map((item: { name: string }) => item.name)).toEqual(['large pan']);
        expect(search.body.map((item: { name: string }) => item.name).sort()).toEqual(['large pan', 'saucepan']);
    });

    test('gets one item, or 404', async () => {
        const item = await createItem('saucepan');

        expect((await request.get(`/api/equipment/${item.id}`)).body).toMatchObject({ name: 'saucepan' });
        expect((await request.get(`/api/equipment/${randomUUID()}`)).body).toEqual({ error: 'Equipment not found.' });
    });

    test('renames, refusing a taken name with 409 and an unknown item with 404', async () => {
        await createItem('saucepan');
        const item = await createItem('pan');

        const renamed = await request.patch(`/api/equipment/${item.id}`).send({ name: 'Large Pan' });
        const taken = await request.patch(`/api/equipment/${item.id}`).send({ name: 'saucepan' });
        const missing = await request.patch(`/api/equipment/${randomUUID()}`).send({ name: 'wok' });

        expect(renamed.body).toMatchObject({ name: 'large pan' });
        expect(taken.status).toBe(409);
        expect(missing.status).toBe(404);
    });

    test('deletes an unused item, refuses one a recipe uses, and 404s a missing one', async () => {
        const unused = await createItem('wok');
        const used = await createItem('saucepan');
        const chili = await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
        await request.patch(`/api/recipes/${chili.id}`).send({ equipment: [{ equipmentId: used.id }] });

        const deleted = await request.delete(`/api/equipment/${unused.id}`);
        const refused = await request.delete(`/api/equipment/${used.id}`);
        const missing = await request.delete(`/api/equipment/${randomUUID()}`);

        expect(deleted.body).toEqual({ message: 'Equipment deleted successfully.' });
        expect(refused.status).toBe(409);
        expect(refused.body).toEqual({ error: 'Cannot delete equipment that is used in recipes.' });
        expect(await prisma.equipment.count({ where: { id: used.id } })).toBe(1);
        expect(missing.status).toBe(404);
    });
});
