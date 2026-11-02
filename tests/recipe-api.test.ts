/**
 * @module tests/recipe-api.test
 * Integration tests for the Recipe API endpoints.
 *
 * Covers GET (list, by-id, search, includes), POST (with/without
 * ingredients, validation), PATCH (partial update, ingredient
 * replacement), and DELETE (cascade behaviour).
 */

import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

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
