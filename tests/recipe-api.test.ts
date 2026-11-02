/**
 * @module tests/recipe-api.test
 * Integration tests for the Recipe API endpoints.
 *
 * Covers GET (list, by-id, search, includes), POST (with/without
 * ingredients, validation, units, line order), PATCH (partial update,
 * ingredient replacement, updatedAt), and DELETE (cascade behaviour).
 */

import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

/** Look up a seeded ingredient's id by its (unique) name. */
async function idOf(name: string): Promise<string> {
    return (await prisma.ingredient.findUniqueOrThrow({ where: { name } })).id;
}

/** The seeded Beef Chili. */
function beefChili() {
    return prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
}

/** A line as the API returns it. */
interface ReturnedLine {
    id: string;
    orderIndex: number;
    quantity: number | null;
    quantityMax: number | null;
    unit: string | null;
    note: string | null;
    ingredient: { name: string };
}

/** Keep only the fields a client sends (plus position), for comparing lines. */
function summarise(lines: ReturnedLine[]) {
    return lines.map(({ ingredient, orderIndex, quantity, quantityMax, unit, note }) => ({
        name: ingredient.name,
        orderIndex,
        quantity,
        quantityMax,
        unit,
        note,
    }));
}

describe('Recipe API', () => {
    setupTestLifecycle();

    // ── GET ─────────────────────────────────────────────────────────────────

    describe('GET /api/recipes', () => {
        test('should return all seeded recipes', async () => {
            const response = await request.get('/api/recipes');

            expect(response.status).toBe(200);
            expect(response.body).toBeInstanceOf(Array);
            expect(response.body.length).toBeGreaterThan(0);
        });

        test('should include nested recipeIngredients', async () => {
            const response = await request.get('/api/recipes');

            expect(response.status).toBe(200);
            expect(response.body[0].recipeIngredients).toBeDefined();
            expect(response.body[0].recipeIngredients).toBeInstanceOf(Array);
        });

        test('should return a specific recipe with ingredients by ID', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });

            const response = await request.get(`/api/recipes/${recipe?.id}`);

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Beef Chili');
            expect(response.body.recipeIngredients).toBeInstanceOf(Array);
            expect(response.body.recipeIngredients.length).toBeGreaterThan(0);
            expect(response.body.recipeIngredients[0].ingredient).toBeDefined();
            expect(response.body.recipeIngredients[0].ingredient.name).toBeDefined();
        });

        test('should return 404 for a non-existent ID', async () => {
            const response = await request.get(`/api/recipes/${randomUUID()}`);

            expect(response.status).toBe(404);
        });

        test('should return matching recipes when using ?search=', async () => {
            const response = await request.get('/api/recipes?search=beef');

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0].name).toBe('Beef Chili');
        });

        test('should return an empty array when search has no matches', async () => {
            const response = await request.get('/api/recipes?search=nonexistentrecipe');

            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });
    });

    // ── POST ────────────────────────────────────────────────────────────────

    describe('POST /api/recipes', () => {
        test('should create a recipe with ingredients', async () => {
            const onion = await prisma.ingredient.findFirst({ where: { name: 'onion' } });
            const garlic = await prisma.ingredient.findFirst({ where: { name: 'garlic' } });

            const response = await request.post('/api/recipes').send({
                name: 'Garlic Soup',
                description: 'Simple and flavourful',
                servings: 2,
                prepTime: 10,
                cookTime: 30,
                instructions: 'Chop onions, mince garlic, simmer together.',
                ingredients: [
                    { ingredientId: onion?.id, quantity: 2 }, // a count: no unit
                    { ingredientId: garlic?.id, quantity: 6, unit: 'cloves' },
                ],
            });

            expect(response.status).toBe(201);
            expect(response.body.name).toBe('Garlic Soup');
            expect(response.body.servings).toBe(2);
            expect(response.body.recipeIngredients).toHaveLength(2);
            expect(response.body.recipeIngredients[0].ingredient).toBeDefined();
        });

        test('should create a recipe without ingredients', async () => {
            const response = await request.post('/api/recipes').send({ name: 'Mystery Stew' });

            expect(response.status).toBe(201);
            expect(response.body.name).toBe('Mystery Stew');
            expect(response.body.servings).toBe(1); // Default
            expect(response.body.recipeIngredients).toHaveLength(0);
        });

        test('should return 400 when name is missing', async () => {
            const response = await request
                .post('/api/recipes')
                .send({ description: 'A recipe with no name' });

            expect(response.status).toBe(400);
        });

        test('should return 400 when an ingredient ID is invalid', async () => {
            const response = await request.post('/api/recipes').send({
                name: 'Bad Recipe',
                ingredients: [{ ingredientId: randomUUID(), quantity: 1, unit: 'cup' }],
            });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('ingredient IDs');
        });

        test('should return 400 when an ingredient ID is not an id at all', async () => {
            const response = await request.post('/api/recipes').send({
                name: 'Bad Recipe',
                ingredients: [{ ingredientId: 'onion', quantity: 1 }],
            });

            expect(response.status).toBe(400);
            expect(response.body.fields).toHaveProperty(['ingredients.0.ingredientId']);
        });
    });

    // ── POST validation ─────────────────────────────────────────────────────

    describe('POST /api/recipes validation', () => {
        test.each([
            ['"abc"', 'abc'],
            ['-1', -1],
            ['1.5', 1.5],
            ['0', 0],
            ['null', null],
        ])('should return 400 for servings %s', async (_label, servings) => {
            const response = await request.post('/api/recipes').send({ name: 'Bad', servings });

            expect(response.status).toBe(400);
            expect(response.body.fields).toHaveProperty(['servings']);
        });

        test.each([
            ['-5', -5],
            ['2.5', 2.5],
            ['"10"', '10'],
        ])('should return 400 for prepTime %s', async (_label, prepTime) => {
            const response = await request.post('/api/recipes').send({ name: 'Bad', prepTime });

            expect(response.status).toBe(400);
            expect(response.body.fields).toHaveProperty(['prepTime']);
        });

        test.each([
            ['a quantity of 0', { quantity: 0 }, 'quantity'],
            ['a negative quantity', { quantity: -1 }, 'quantity'],
            ['a quantity sent as a string', { quantity: '2' }, 'quantity'],
            ['quantityMax below quantity', { quantity: 3, quantityMax: 2 }, 'quantityMax'],
            ['quantityMax without quantity', { quantityMax: 2 }, 'quantityMax'],
            ['an unknown unit', { quantity: 1, unit: 'handfull' }, 'unit'],
            ['a note over 200 characters', { note: 'x'.repeat(201) }, 'note'],
        ])('should return 400 for %s', async (_label, line, field) => {
            const response = await request.post('/api/recipes').send({
                name: 'Bad',
                ingredients: [{ ingredientId: await idOf('onion'), ...line }],
            });

            expect(response.status).toBe(400);
            expect(response.body.fields).toHaveProperty([`ingredients.0.${field}`]);
        });

        test('should list the allowed units when a unit is unknown', async () => {
            const response = await request.post('/api/recipes').send({
                name: 'Bad',
                ingredients: [{ ingredientId: await idOf('onion'), quantity: 1, unit: 'handfull' }],
            });

            expect(response.body.fields['ingredients.0.unit']).toContain('Unknown unit "handfull"');
            expect(response.body.fields['ingredients.0.unit']).toContain('handful');
        });

        test('should store unit aliases as canonical symbols', async () => {
            const onion = await idOf('onion');

            const response = await request.post('/api/recipes').send({
                name: 'Units',
                ingredients: [
                    { ingredientId: onion, quantity: 200, unit: 'grams' },
                    { ingredientId: onion, quantity: 1, unit: ' Tbsp. ' },
                    { ingredientId: onion, quantity: 2, unit: 'tins' },
                    { ingredientId: onion, quantity: 3, unit: '' },
                ],
            });

            expect(response.status).toBe(201);
            const units = response.body.recipeIngredients.map((l: ReturnedLine) => l.unit);
            expect(units).toEqual(['g', 'tbsp', 'can', null]);
        });

        test('should return 400 for unknown fields, at the top level and in a line', async () => {
            const response = await request.post('/api/recipes').send({
                name: 'Sneaky',
                createdAt: '2020-01-01T00:00:00.000Z',
                ingredients: [{ ingredientId: await idOf('onion'), quantity: 1, orderIndex: 7 }],
            });

            expect(response.status).toBe(400);
            expect(response.body.fields).toEqual({
                createdAt: 'Unknown field.',
                'ingredients.0.orderIndex': 'Unknown field.',
            });
        });
    });

    // ── Ingredient lines ────────────────────────────────────────────────────

    describe('ingredient lines', () => {
        test('should keep line order, and return null quantity, null unit and notes unchanged', async () => {
            // Deliberately not alphabetical, with onion on two lines.
            const created = await request.post('/api/recipes').send({
                name: 'Line Test',
                ingredients: [
                    { ingredientId: await idOf('tomato puree'), quantity: 2, unit: 'tbsp' },
                    { ingredientId: await idOf('cayenne pepper'), quantity: null, unit: null, note: 'to taste' },
                    { ingredientId: await idOf('onion'), quantity: 1, note: 'for the base' },
                    { ingredientId: await idOf('smoked paprika'), quantity: 1, quantityMax: 2, unit: 'tsp' },
                    { ingredientId: await idOf('onion'), quantity: 0.5, note: 'for the topping' },
                ],
            });
            expect(created.status).toBe(201);

            const fetched = await request.get(`/api/recipes/${created.body.id}`);

            expect(summarise(fetched.body.recipeIngredients)).toEqual([
                { name: 'tomato puree', orderIndex: 0, quantity: 2, quantityMax: null, unit: 'tbsp', note: null },
                { name: 'cayenne pepper', orderIndex: 1, quantity: null, quantityMax: null, unit: null, note: 'to taste' },
                { name: 'onion', orderIndex: 2, quantity: 1, quantityMax: null, unit: null, note: 'for the base' },
                { name: 'smoked paprika', orderIndex: 3, quantity: 1, quantityMax: 2, unit: 'tsp', note: null },
                { name: 'onion', orderIndex: 4, quantity: 0.5, quantityMax: null, unit: null, note: 'for the topping' },
            ]);
        });
    });

    // ── PATCH ───────────────────────────────────────────────────────────────

    describe('PATCH /api/recipes/:id', () => {
        test('should update only the recipe name', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });

            const response = await request
                .patch(`/api/recipes/${recipe?.id}`)
                .send({ name: 'Spicy Beef Chili' });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Spicy Beef Chili');
            expect(response.body.description).toBe(recipe?.description);
        });

        test('should replace all ingredients when an ingredients array is provided', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });
            const garlic = await prisma.ingredient.findFirst({ where: { name: 'garlic' } });

            const response = await request.patch(`/api/recipes/${recipe?.id}`).send({
                ingredients: [{ ingredientId: garlic?.id, quantity: 10, unit: 'cloves' }],
            });

            expect(response.status).toBe(200);
            expect(response.body.recipeIngredients).toHaveLength(1);
            expect(response.body.recipeIngredients[0].ingredient.name).toBe('garlic');
            expect(response.body.recipeIngredients[0].quantity).toBe(10);
        });

        test('should return 404 for a non-existent recipe', async () => {
            const response = await request
                .patch(`/api/recipes/${randomUUID()}`)
                .send({ name: 'Ghost Recipe' });

            expect(response.status).toBe(404);
        });

        test('should return 400 for an empty name', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });

            const response = await request
                .patch(`/api/recipes/${recipe?.id}`)
                .send({ name: '' });

            expect(response.status).toBe(400);
        });

        test('should return 400 when updated ingredient IDs are invalid', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });

            const response = await request.patch(`/api/recipes/${recipe?.id}`).send({
                ingredients: [{ ingredientId: randomUUID(), quantity: 1, unit: 'cup' }],
            });

            expect(response.status).toBe(400);
        });

        test('should change updatedAt when only the ingredients change', async () => {
            const chili = await beefChili();
            // Backdate it in SQL, around Prisma, so the check can't pass by luck.
            const past = new Date('2020-01-01T00:00:00.000Z');
            await prisma.$executeRaw`UPDATE "Recipe" SET "updatedAt" = ${past} WHERE id = ${chili.id}`;

            const response = await request.patch(`/api/recipes/${chili.id}`).send({
                ingredients: [{ ingredientId: await idOf('garlic'), quantity: 2, unit: 'clove' }],
            });

            expect(response.status).toBe(200);
            expect(new Date(response.body.updatedAt).getTime()).toBeGreaterThan(past.getTime());
        });

        test('should leave the lines alone when ingredients is absent', async () => {
            const chili = await beefChili();
            const before = await prisma.recipeIngredient.findMany({
                where: { recipeId: chili.id },
                orderBy: { orderIndex: 'asc' },
            });

            const response = await request
                .patch(`/api/recipes/${chili.id}`)
                .send({ name: 'Beef Chili (mild)' });

            expect(response.status).toBe(200);
            const ids = response.body.recipeIngredients.map((l: ReturnedLine) => l.id);
            expect(ids).toEqual(before.map((l) => l.id)); // the same rows, not re-created
        });

        test('should remove every line when ingredients is an empty array', async () => {
            const chili = await beefChili();

            const response = await request.patch(`/api/recipes/${chili.id}`).send({ ingredients: [] });

            expect(response.status).toBe(200);
            expect(response.body.recipeIngredients).toEqual([]);
            expect(await prisma.recipeIngredient.count({ where: { recipeId: chili.id } })).toBe(0);
        });

        test('should not reset servings when a PATCH leaves it out', async () => {
            const chili = await beefChili();
            expect(chili.servings).toBe(2);

            const response = await request.patch(`/api/recipes/${chili.id}`).send({ name: 'Renamed' });

            expect(response.body.servings).toBe(2);
        });

        test('should return 400 for an unknown field or a null servings', async () => {
            const chili = await beefChili();

            const unknown = await request.patch(`/api/recipes/${chili.id}`).send({ id: randomUUID() });
            const nullServings = await request.patch(`/api/recipes/${chili.id}`).send({ servings: null });

            expect(unknown.status).toBe(400);
            expect(unknown.body.fields).toEqual({ id: 'Unknown field.' });
            expect(nullServings.status).toBe(400);
            expect(nullServings.body.fields).toHaveProperty(['servings']);
        });
    });

    // ── DELETE ───────────────────────────────────────────────────────────────

    describe('DELETE /api/recipes/:id', () => {
        test('should delete a recipe', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });

            const response = await request.delete(`/api/recipes/${recipe?.id}`);

            expect(response.status).toBe(200);

            const deleted = await prisma.recipe.findUnique({ where: { id: recipe?.id } });
            expect(deleted).toBeNull();
        });

        test('should cascade-delete RecipeIngredients but preserve Ingredients', async () => {
            const recipe = await prisma.recipe.findFirst({ where: { name: 'Beef Chili' } });
            const ingredientCountBefore = await prisma.ingredient.count();

            await request.delete(`/api/recipes/${recipe?.id}`);

            const orphanedLinks = await prisma.recipeIngredient.findMany({
                where: { recipeId: recipe?.id as string },
            });
            expect(orphanedLinks).toHaveLength(0);

            const ingredientCountAfter = await prisma.ingredient.count();
            expect(ingredientCountAfter).toBe(ingredientCountBefore);
        });

        test('should return 404 for a non-existent recipe', async () => {
            const response = await request.delete(`/api/recipes/${randomUUID()}`);

            expect(response.status).toBe(404);
        });
    });
});
