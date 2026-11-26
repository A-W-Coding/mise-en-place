/**
 * @module tests/recipe-tags-equipment.test
 * A recipe's tags and equipment lines (3b, spec §3.2): written in the
 * recipe's POST or PATCH body (`tagIds`, `equipment`), replacing what's
 * there, read back in order, shown on list rows (tags), and used to filter
 * the list (`?tag=`).
 */

import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

async function created(path: string, body: object): Promise<string> {
    const response = await request.post(path).send(body);
    expect(response.status).toBe(201);
    return response.body.id as string;
}

type TagLine = { tagId: string; orderIndex: number; tag: { name: string; color: string | null } };
type EquipmentLine = { quantity: number; optional: boolean; orderIndex: number; equipment: { name: string } };

const tagNames = (recipe: { tags: TagLine[] }) => recipe.tags.map((line) => line.tag.name);
const equipmentOf = (recipe: { equipment: EquipmentLine[] }) =>
    recipe.equipment.map((line) => [line.equipment.name, line.quantity, line.optional]);

describe("a recipe's tags and equipment", () => {
    setupTestLifecycle();

    let beef: string;
    let spicy: string;
    let weeknight: string;
    let pan: string;
    let spoon: string;

    beforeEach(async () => {
        beef = await created('/api/tags', { name: 'beef', color: '#f6c7bd' });
        spicy = await created('/api/tags', { name: 'spicy' });
        weeknight = await created('/api/tags', { name: 'weeknight', color: '#1f4e79' });
        pan = await created('/api/equipment', { name: 'large pan' });
        spoon = await created('/api/equipment', { name: 'wooden spoon' });
    });

    test('a new recipe saves them in order, with each tag and item, and line defaults', async () => {
        const response = await request.post('/api/recipes').send({
            name: 'Chilli Bowl',
            tagIds: [spicy, beef],
            equipment: [{ equipmentId: pan, quantity: 2 }, { equipmentId: spoon, optional: true }],
        });

        expect(response.status).toBe(201);
        expect(response.body.tags).toEqual([
            { recipeId: response.body.id, tagId: spicy, orderIndex: 0, tag: expect.objectContaining({ name: 'spicy', color: null }) },
            { recipeId: response.body.id, tagId: beef, orderIndex: 1, tag: expect.objectContaining({ name: 'beef', color: '#f6c7bd' }) },
        ]);
        expect(equipmentOf(response.body)).toEqual([
            ['large pan', 2, false],
            ['wooden spoon', 1, true],
        ]);
        expect(response.body.equipment[1]).toMatchObject({ orderIndex: 1, equipmentId: spoon, recipeId: response.body.id });

        // And GET returns the same
        const read = await request.get(`/api/recipes/${response.body.id}`);
        expect(read.body.tags).toEqual(response.body.tags);
        expect(read.body.equipment).toEqual(response.body.equipment);
    });

    test('a recipe with neither has empty lists', async () => {
        const response = await request.post('/api/recipes').send({ name: 'Toast' });

        expect(response.body).toMatchObject({ tags: [], equipment: [] });
    });

    test('PATCH replaces them, leaves them when absent, and clears them with []', async () => {
        const id = await created('/api/recipes', { name: 'Chilli Bowl', tagIds: [beef], equipment: [{ equipmentId: pan }] });
        const before = await prisma.recipe.findUniqueOrThrow({ where: { id } });

        const replaced = await request.patch(`/api/recipes/${id}`).send({ tagIds: [weeknight, beef], equipment: [{ equipmentId: spoon }] });
        const untouched = await request.patch(`/api/recipes/${id}`).send({ servings: 4 });
        const cleared = await request.patch(`/api/recipes/${id}`).send({ tagIds: [], equipment: [] });

        expect(tagNames(replaced.body)).toEqual(['weeknight', 'beef']);
        expect(equipmentOf(replaced.body)).toEqual([['wooden spoon', 1, false]]);
        expect(new Date(replaced.body.updatedAt).getTime()).toBeGreaterThan(before.updatedAt.getTime());
        expect(tagNames(untouched.body)).toEqual(['weeknight', 'beef']);
        expect(equipmentOf(untouched.body)).toEqual([['wooden spoon', 1, false]]);
        expect(cleared.body).toMatchObject({ tags: [], equipment: [] });
    });

    test('the same item can be on two lines', async () => {
        const response = await request.post('/api/recipes').send({
            name: 'Two Pans',
            equipment: [{ equipmentId: pan }, { equipmentId: pan, optional: true }],
        });

        expect(equipmentOf(response.body)).toEqual([
            ['large pan', 1, false],
            ['large pan', 1, true],
        ]);
    });

    test.each([
        [{ tagIds: 'beef' }, 'tagIds', 'Must be an array of tag ids.'],
        [{ tagIds: ['beef'] }, 'tagIds.0', 'Must be a tag id.'],
        [{ equipment: [{}] }, 'equipment.0.equipmentId', 'Required.'],
        [{ equipment: [{ equipmentId: 'x' }] }, 'equipment.0.equipmentId', 'Must be an equipment id.'],
        [{ equipment: [{ equipmentId: randomUUID(), quantity: 0 }] }, 'equipment.0.quantity', 'Must be at least 1.'],
        [{ equipment: [{ equipmentId: randomUUID(), quantity: 100 }] }, 'equipment.0.quantity', 'Must be at most 99.'],
        [{ equipment: [{ equipmentId: randomUUID(), quantity: 1.5 }] }, 'equipment.0.quantity', 'Must be a whole number.'],
        [{ equipment: [{ equipmentId: randomUUID(), optional: 'yes' }] }, 'equipment.0.optional', 'Must be true or false.'],
    ])('refuses %j', async (extra, field, message) => {
        const response = await request.post('/api/recipes').send({ name: 'Bad', ...extra });

        expect(response.status).toBe(400);
        expect(response.body.fields).toEqual({ [field]: message });
    });

    test('refuses a tag twice, an unknown field on a line, and changes nothing', async () => {
        const twice = await request.post('/api/recipes').send({ name: 'Bad', tagIds: [beef, spicy, beef] });
        const unknown = await request.post('/api/recipes').send({ name: 'Bad', equipment: [{ equipmentId: pan, note: 'big' }] });

        expect(twice.status).toBe(400);
        expect(twice.body.fields).toEqual({ 'tagIds.2': 'Each tag only once.' });
        expect(unknown.status).toBe(400);
        expect(await prisma.recipe.count({ where: { name: 'Bad' } })).toBe(0);
    });

    test("a tag or item that doesn't exist is a 400 that says which, and writes nothing", async () => {
        const id = await created('/api/recipes', { name: 'Chilli Bowl', tagIds: [beef] });

        const tag = await request.post('/api/recipes').send({ name: 'Bad', tagIds: [beef, randomUUID()] });
        const item = await request.patch(`/api/recipes/${id}`).send({ name: 'Renamed', equipment: [{ equipmentId: randomUUID() }] });

        expect(tag.status).toBe(400);
        expect(tag.body).toEqual({ error: 'One or more tag IDs are invalid.' });
        expect(item.status).toBe(400);
        expect(item.body).toEqual({ error: 'One or more equipment IDs are invalid.' });
        expect(await prisma.recipe.count({ where: { name: { in: ['Bad', 'Renamed'] } } })).toBe(0);
        expect(tagNames((await request.get(`/api/recipes/${id}`)).body)).toEqual(['beef']);
    });

    test("a stale If-Match changes neither, as for the rest of the recipe", async () => {
        const id = await created('/api/recipes', { name: 'Chilli Bowl', tagIds: [beef] });
        const stale = `"${Date.parse('2020-01-01T00:00:00Z')}"`;

        const response = await request.patch(`/api/recipes/${id}`).set('If-Match', stale).send({ tagIds: [spicy] });

        expect(response.status).toBe(412);
        expect(tagNames((await request.get(`/api/recipes/${id}`)).body)).toEqual(['beef']);
    });

    test('deleting a recipe leaves the shared tags and items', async () => {
        const id = await created('/api/recipes', { name: 'Chilli Bowl', tagIds: [beef], equipment: [{ equipmentId: pan }] });

        await request.delete(`/api/recipes/${id}`);

        expect(await prisma.tag.count()).toBe(3);
        expect(await prisma.equipment.count()).toBe(2);
        expect(await prisma.recipeTag.count()).toBe(0);
    });

    describe('the list', () => {
        test("rows carry each recipe's tags, in its order, but no equipment", async () => {
            await created('/api/recipes', { name: 'Apple Pie', tagIds: [weeknight, spicy, beef], equipment: [{ equipmentId: pan }] });

            const response = await request.get('/api/recipes');

            const pie = response.body.find((recipe: { name: string }) => recipe.name === 'Apple Pie');
            expect(tagNames(pie)).toEqual(['weeknight', 'spicy', 'beef']);
            expect(pie).not.toHaveProperty('equipment');
            expect(response.body.find((recipe: { name: string }) => recipe.name === 'Beef Chili').tags).toEqual([]);
        });

        test('?tag= lists only recipes with that tag, by name, with their total', async () => {
            await created('/api/recipes', { name: 'Chilli Bowl', tagIds: [beef, weeknight] });
            await created('/api/recipes', { name: 'Apple Pie', tagIds: [weeknight] });
            await created('/api/recipes', { name: 'Beef Stew', tagIds: [beef] });

            const response = await request.get(`/api/recipes?tag=${weeknight}`);
            const paged = await request.get(`/api/recipes?tag=${weeknight}&limit=1&offset=1`);

            expect(response.body.map((recipe: { name: string }) => recipe.name)).toEqual(['Apple Pie', 'Chilli Bowl']);
            expect(response.headers['x-total-count']).toBe('2');
            expect(paged.body.map((recipe: { name: string }) => recipe.name)).toEqual(['Chilli Bowl']);
            expect(paged.headers['x-total-count']).toBe('2');
        });

        test('?tag= works with a search, and an unknown tag finds nothing', async () => {
            await created('/api/recipes', { name: 'Chilli Bowl', tagIds: [beef] });
            await created('/api/recipes', { name: 'Chilli Beans', tagIds: [spicy] });

            const both = await request.get(`/api/recipes?search=chilli&tag=${beef}`);
            const nothing = await request.get(`/api/recipes?tag=${randomUUID()}`);

            expect(both.body.map((recipe: { name: string }) => recipe.name)).toEqual(['Chilli Bowl']);
            expect(both.headers['x-total-count']).toBe('1');
            expect(both.body[0].tags).toHaveLength(1);
            expect(nothing.status).toBe(200);
            expect(nothing.body).toEqual([]);
            expect(nothing.headers['x-total-count']).toBe('0');
        });

        test('?tag= must be one tag id', async () => {
            const bad = await request.get('/api/recipes?tag=beef');
            const twice = await request.get(`/api/recipes?tag=${beef}&tag=${spicy}`);

            expect(bad.status).toBe(400);
            expect(bad.body.fields).toEqual({ tag: 'Must be a single tag id.' });
            expect(twice.status).toBe(400);
        });

        test('the ingredient list takes no tag', async () => {
            const response = await request.get(`/api/ingredients?tag=${beef}`);

            expect(response.status).toBe(400);
        });
    });
});
