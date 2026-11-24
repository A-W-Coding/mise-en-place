/**
 * A recipe's method as sections and steps, and its ingredient lines grouped
 * under them (3b, spec §3.2): written in the recipe's POST or PATCH body,
 * replacing what's there, and read back in order.
 */

import supertest from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

async function ingredientId(name: string): Promise<string> {
    return (await prisma.ingredient.findFirstOrThrow({ where: { name } })).id;
}

/** A body for a recipe with two sections, a timed step, and lines in each section and none. */
async function soupBody() {
    return {
        name: 'Onion Soup',
        sections: [
            { name: 'Base', steps: [{ text: 'Soften the onions.', timerSeconds: 1200 }, { text: 'Add the stock.' }] },
            { name: 'To serve', steps: [{ text: 'Ladle into bowls.', timerSeconds: null }] },
        ],
        ingredients: [
            { ingredientId: await ingredientId('onion'), quantity: 3, sectionIndex: 0 },
            { ingredientId: await ingredientId('beef stock'), quantity: 1, sectionIndex: 0 },
            { ingredientId: await ingredientId('cayenne pepper'), quantity: null, sectionIndex: null },
            { ingredientId: await ingredientId('garlic'), quantity: 1 },
        ],
    };
}

/** A response's method, without ids: each section's name and its steps. */
function method(recipe: {
    sections: { name: string; orderIndex: number; steps: { orderIndex: number; text: string; timerSeconds: number | null }[] }[];
}) {
    return recipe.sections.map((section) => ({
        name: section.name,
        orderIndex: section.orderIndex,
        steps: section.steps.map((step) => [step.orderIndex, step.text, step.timerSeconds]),
    }));
}

/** Each line's section, by name, or null. */
function lineSections(recipe: {
    sections: { id: string; name: string }[];
    recipeIngredients: { sectionId: string | null }[];
}) {
    return recipe.recipeIngredients.map((line) => recipe.sections.find((section) => section.id === line.sectionId)?.name ?? null);
}

describe('sections and steps', () => {
    setupTestLifecycle();

    test('POST creates them in order, with their timers, and lines in their sections', async () => {
        const response = await request.post('/api/recipes').send(await soupBody());

        expect(response.status).toBe(201);
        expect(method(response.body)).toEqual([
            { name: 'Base', orderIndex: 0, steps: [[0, 'Soften the onions.', 1200], [1, 'Add the stock.', null]] },
            { name: 'To serve', orderIndex: 1, steps: [[0, 'Ladle into bowls.', null]] },
        ]);
        expect(lineSections(response.body)).toEqual(['Base', 'Base', null, null]);
        expect(response.body).not.toHaveProperty('instructions');

        // And GET returns exactly the same
        const read = await request.get(`/api/recipes/${response.body.id}`);
        expect(read.body).toEqual(response.body);
    });

    test('the seeded recipe has its method as one section, "Method"', async () => {
        const chili = await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });

        const response = await request.get(`/api/recipes/${chili.id}`);

        expect(response.body.sections).toHaveLength(1);
        expect(response.body.sections[0].name).toBe('Method');
        expect(response.body.sections[0].steps).toHaveLength(14);
        expect(response.body.recipeIngredients.every((line: { sectionId: string | null }) => line.sectionId === null)).toBe(true);
    });

    test('PATCH replaces the sections and lines together, and the old sections are gone', async () => {
        const created = (await request.post('/api/recipes').send(await soupBody())).body;
        const onion = await ingredientId('onion');

        const response = await request
            .patch(`/api/recipes/${created.id}`)
            .set('If-Match', created.updatedAt ? `"${Date.parse(created.updatedAt)}"` : '')
            .send({
                sections: [{ name: 'All of it', steps: [{ text: 'Cook everything.' }] }],
                ingredients: [{ ingredientId: onion, quantity: 2, sectionIndex: 0 }],
            });

        expect(response.status).toBe(200);
        expect(method(response.body)).toEqual([{ name: 'All of it', orderIndex: 0, steps: [[0, 'Cook everything.', null]] }]);
        expect(lineSections(response.body)).toEqual(['All of it']);
        expect(await prisma.recipeSection.count({ where: { recipeId: created.id } })).toBe(1);
        const stepsLeft = await prisma.instruction.count({ where: { section: { recipeId: created.id } } });
        expect(stepsLeft).toBe(1);
    });

    test('PATCH without sections leaves them, and the lines, as they were', async () => {
        const created = (await request.post('/api/recipes').send(await soupBody())).body;

        const response = await request.patch(`/api/recipes/${created.id}`).send({ name: 'French Onion Soup' });

        expect(response.status).toBe(200);
        expect(method(response.body)).toEqual(method(created));
        expect(lineSections(response.body)).toEqual(['Base', 'Base', null, null]);
    });

    test('PATCH with only lines keeps the sections, and an empty array removes them all', async () => {
        const created = (await request.post('/api/recipes').send(await soupBody())).body;

        const linesOnly = await request
            .patch(`/api/recipes/${created.id}`)
            .send({ ingredients: [{ ingredientId: await ingredientId('garlic'), quantity: 2 }] });
        expect(method(linesOnly.body)).toEqual(method(created));

        const cleared = await request.patch(`/api/recipes/${created.id}`).send({ sections: [], ingredients: [] });
        expect(cleared.body.sections).toEqual([]);
        expect(cleared.body.recipeIngredients).toEqual([]);
    });

    test('a stale If-Match changes nothing, sections included (412)', async () => {
        const created = (await request.post('/api/recipes').send(await soupBody())).body;
        const etag = `"${Date.parse(created.updatedAt)}"`;
        await request.patch(`/api/recipes/${created.id}`).set('If-Match', etag).send({ name: 'Changed elsewhere' });

        const response = await request
            .patch(`/api/recipes/${created.id}`)
            .set('If-Match', etag)
            .send({ sections: [], ingredients: [] });

        expect(response.status).toBe(412);
        expect(await prisma.recipeSection.count({ where: { recipeId: created.id } })).toBe(2);
        expect(await prisma.recipeIngredient.count({ where: { recipeId: created.id } })).toBe(4);
    });

    test('deleting a recipe deletes its sections and steps', async () => {
        const created = (await request.post('/api/recipes').send(await soupBody())).body;

        await request.delete(`/api/recipes/${created.id}`).expect(200);

        expect(await prisma.recipeSection.count({ where: { recipeId: created.id } })).toBe(0);
        expect(await prisma.instruction.count()).toBe(14); // only Beef Chili's
    });

    test('a section with no steps can still group lines', async () => {
        const response = await request.post('/api/recipes').send({
            name: 'Salad',
            sections: [{ name: 'Dressing', steps: [] }],
            ingredients: [{ ingredientId: await ingredientId('garlic'), quantity: 1, sectionIndex: 0 }],
        });

        expect(response.status).toBe(201);
        expect(lineSections(response.body)).toEqual(['Dressing']);
    });

    describe('is refused with 400, changing nothing,', () => {
        test.each<[string, Record<string, unknown>, Record<string, string>]>([
            ['for sections without ingredients', { sections: [] }, { ingredients: 'Required with sections, so lines keep their sections.' }],
            [
                'for a sectionIndex past the sections',
                { sections: [{ name: 'Base', steps: [] }], ingredients: [{ sectionIndex: 1 }] },
                { 'ingredients.0.sectionIndex': 'Must point to one of the 1 section.' },
            ],
            [
                'for a sectionIndex with no sections',
                { ingredients: [{ sectionIndex: 0 }] },
                { 'ingredients.0.sectionIndex': 'Only allowed with sections.' },
            ],
            ['for an empty section name', { sections: [{ name: '  ', steps: [] }], ingredients: [] }, { 'sections.0.name': 'Must not be empty.' }],
            [
                'for a section name over 100 characters',
                { sections: [{ name: 'x'.repeat(101), steps: [] }], ingredients: [] },
                { 'sections.0.name': 'Must be at most 100 characters.' },
            ],
            [
                'for an empty step',
                { sections: [{ name: 'Base', steps: [{ text: '' }] }], ingredients: [] },
                { 'sections.0.steps.0.text': 'Must not be empty.' },
            ],
            [
                'for a step over 2,000 characters',
                { sections: [{ name: 'Base', steps: [{ text: 'x'.repeat(2001) }] }], ingredients: [] },
                { 'sections.0.steps.0.text': 'Must be at most 2000 characters.' },
            ],
            [
                'for a timer of 0',
                { sections: [{ name: 'Base', steps: [{ text: 'Wait.', timerSeconds: 0 }] }], ingredients: [] },
                { 'sections.0.steps.0.timerSeconds': 'Must be at least 1.' },
            ],
            [
                'for a timer over a day',
                { sections: [{ name: 'Base', steps: [{ text: 'Wait.', timerSeconds: 86_401 }] }], ingredients: [] },
                { 'sections.0.steps.0.timerSeconds': 'Must be at most 86400.' },
            ],
            [
                'for a timer that is not whole seconds',
                { sections: [{ name: 'Base', steps: [{ text: 'Wait.', timerSeconds: 1.5 }] }], ingredients: [] },
                { 'sections.0.steps.0.timerSeconds': 'Must be a whole number.' },
            ],
            ['for Phase 1 instructions, now unknown', { instructions: 'Stir.' }, { instructions: expect.any(String) as unknown as string }],
        ])('%s', async (_case, changes, fields) => {
            const chili = await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
            const garlic = await ingredientId('garlic');
            const body = { ...changes };
            if (Array.isArray(body.ingredients)) {
                body.ingredients = (body.ingredients as Record<string, unknown>[]).map((line) => ({ ingredientId: garlic, ...line }));
            }
            const before = await request.get(`/api/recipes/${chili.id}`);

            const response = await request.patch(`/api/recipes/${chili.id}`).send(body);

            expect(response.status).toBe(400);
            expect(response.body.fields).toMatchObject(fields);
            expect((await request.get(`/api/recipes/${chili.id}`)).body).toEqual(before.body);
        });
    });
});
