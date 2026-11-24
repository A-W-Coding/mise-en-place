/**
 * @module web/src/test/fakeServer
 * A small stand-in for the API, in memory, for testing uploads (3c): it keeps
 * recipes and ingredients, sends ETags and honours `If-Match`, refuses a
 * taken id or ingredient name with 409, and serves the snapshot.
 *
 * It can also be unreachable, or do a request's work and then lose its
 * answer, which is how a dropped connection looks to the app.
 */

import type { Ingredient, Recipe } from '../api/types';
import { json, mockApi, page } from './renderApp';

interface LineIn {
    ingredientId: string;
    quantity?: number | null;
    quantityMax?: number | null;
    unit?: string | null;
    note?: string | null;
    sectionIndex?: number | null;
}

interface SectionIn {
    name: string;
    steps: { text: string; timerSeconds?: number | null }[];
}

interface RecipeIn {
    id?: string;
    name: string;
    description?: string | null;
    servings?: number;
    prepTime?: number | null;
    cookTime?: number | null;
    sections?: SectionIn[];
    ingredients?: LineIn[];
}

export function fakeServer(seed: { recipes?: Recipe[] } = {}) {
    const ingredients = new Map<string, Ingredient>();
    const recipes = new Map<string, Recipe>();
    for (const recipe of seed.recipes ?? []) {
        recipes.set(recipe.id, recipe);
        for (const line of recipe.recipeIngredients) ingredients.set(line.ingredient.id, line.ingredient);
    }
    let clock = Date.parse('2026-11-24T10:00:00.000Z');
    let counter = 0;
    const lose: { method: string; path: string }[] = [];
    const server = {
        reachable: true,
        recipes,
        ingredients,
        /** Do the next matching request's work, then drop its answer. */
        loseAnswer(method: string, path: string) {
            lose.push({ method, path });
        },
        etagOf: (recipe: Recipe) => `"${Date.parse(recipe.updatedAt)}"`,
        /** Change a recipe as another device would. */
        changeElsewhere(id: string, change: Partial<Recipe>) {
            const recipe = recipes.get(id);
            if (!recipe) throw new Error(`No recipe ${id}.`);
            recipes.set(id, { ...recipe, ...change, updatedAt: stamp() });
        },
        fetchMock: undefined as unknown as ReturnType<typeof mockApi>,
    };

    function stamp(): string {
        clock += 1000;
        return new Date(clock).toISOString();
    }

    const nextId = (prefix: string) => `${prefix}-${String((counter += 1)).padStart(4, '0')}-4000-8000-000000000000`;
    const withEtag = (recipe: Recipe, status = 200) => json(recipe, { status, headers: { ETag: server.etagOf(recipe) } });
    const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as unknown;
    const header = (init: RequestInit, name: string) => ((init.headers ?? {}) as Record<string, string>)[name];

    function build(id: string, input: RecipeIn, createdAt: string): Recipe | null {
        const lines = input.ingredients ?? [];
        if (lines.some((line) => !ingredients.has(line.ingredientId))) return null;
        const sectionIds = (input.sections ?? []).map((_, index) => `${id}-section-${index}`);
        return {
            id,
            name: input.name.trim(),
            description: input.description ?? null,
            servings: input.servings ?? 1,
            prepTime: input.prepTime ?? null,
            cookTime: input.cookTime ?? null,
            sections: (input.sections ?? []).map((section, index) => ({
                id: sectionIds[index]!,
                recipeId: id,
                name: section.name,
                orderIndex: index,
                steps: section.steps.map((step, orderIndex) => ({
                    id: `${sectionIds[index]}-${orderIndex}`,
                    sectionId: sectionIds[index]!,
                    orderIndex,
                    text: step.text,
                    timerSeconds: step.timerSeconds ?? null,
                })),
            })),
            createdAt,
            updatedAt: stamp(),
            recipeIngredients: lines.map((line, index) => ({
                id: `${id}-line-${index}`,
                recipeId: id,
                ingredientId: line.ingredientId,
                orderIndex: index,
                quantity: line.quantity ?? null,
                quantityMax: line.quantityMax ?? null,
                unit: line.unit ?? null,
                note: line.note ?? null,
                sectionId: line.sectionIndex === null || line.sectionIndex === undefined ? null : (sectionIds[line.sectionIndex] ?? null),
                ingredient: ingredients.get(line.ingredientId)!,
            })),
        };
    }

    const invalidIds = () => json({ error: 'One or more ingredient IDs are invalid.' }, { status: 400 });
    const notFound = () => json({ error: 'Recipe not found.' }, { status: 404 });
    const idFrom = (url: URL) => decodeURIComponent(url.pathname.split('/').pop() ?? '');

    type Handler = (url: URL, init: RequestInit) => Response;
    const routes: [string, string | RegExp, Handler][] = [
        [
            'POST',
            '/api/ingredients',
            (_url, init) => {
                const name = String((bodyOf(init) as { name: string }).name).trim().toLowerCase();
                if ([...ingredients.values()].some((ingredient) => ingredient.name === name)) {
                    return json({ error: 'An ingredient with that name already exists.' }, { status: 409 });
                }
                const time = stamp();
                const ingredient = { id: nextId('11111111'), name, createdAt: time, updatedAt: time };
                ingredients.set(ingredient.id, ingredient);
                return json(ingredient, { status: 201 });
            },
        ],
        [
            'GET',
            '/api/ingredients',
            (url) => {
                const search = url.searchParams.get('search') ?? '';
                return page([...ingredients.values()].filter((ingredient) => ingredient.name.includes(search)));
            },
        ],
        [
            'POST',
            '/api/recipes',
            (_url, init) => {
                const input = bodyOf(init) as RecipeIn;
                const id = input.id ?? nextId('22222222');
                if (recipes.has(id)) return json({ error: 'A recipe with that id already exists.' }, { status: 409 });
                const recipe = build(id, input, new Date(clock).toISOString());
                if (!recipe) return invalidIds();
                recipes.set(id, recipe);
                return withEtag(recipe, 201);
            },
        ],
        ['GET', /^\/api\/recipes\/[^/]+$/, (url) => {
            const recipe = recipes.get(idFrom(url));
            return recipe ? withEtag(recipe) : notFound();
        }],
        [
            'PATCH',
            /^\/api\/recipes\/[^/]+$/,
            (url, init) => {
                const current = recipes.get(idFrom(url));
                if (!current) return notFound();
                const ifMatch = header(init, 'If-Match');
                if (ifMatch && ifMatch !== server.etagOf(current)) {
                    return json({ error: 'The recipe has changed since it was loaded.' }, { status: 412 });
                }
                // Like the API, a PATCH without `ingredients` or `sections` keeps them
                const sections = current.sections.map((section) => ({ name: section.name, steps: section.steps }));
                const lines = current.recipeIngredients.map(({ ingredientId, quantity, quantityMax, unit, note, sectionId }) => ({
                    ingredientId,
                    quantity,
                    quantityMax,
                    unit,
                    note,
                    sectionIndex: sectionId === null ? null : current.sections.findIndex((section) => section.id === sectionId),
                }));
                const input = { ...current, sections, ingredients: lines, ...(bodyOf(init) as Partial<RecipeIn>) };
                const recipe = build(current.id, input, current.createdAt);
                if (!recipe) return invalidIds();
                recipes.set(current.id, recipe);
                return withEtag(recipe);
            },
        ],
        ['GET', '/api/recipes', () => page([...recipes.values()].sort((a, b) => a.name.localeCompare(b.name)))],
        [
            'GET',
            '/api/sync',
            () => {
                const all = [...recipes.values()].sort((a, b) => a.name.localeCompare(b.name));
                const snapshot = {
                    recipes: all,
                    ingredients: [...ingredients.values()].sort((a, b) => a.name.localeCompare(b.name)),
                    etags: Object.fromEntries(all.map((recipe) => [recipe.id, server.etagOf(recipe)])),
                };
                return json(snapshot, { headers: { ETag: `"snapshot-${clock}"` } });
            },
        ],
        ['GET', '/api/health', () => json({ status: 'ok' })],
    ];

    server.fetchMock = mockApi(
        routes.map(([method, path, handle]): [string, string | RegExp, Handler] => [
            method,
            path,
            (url, init) => {
                if (!server.reachable) throw new TypeError('Failed to fetch');
                const response = handle(url, init);
                const lost = lose.findIndex((rule) => rule.method === method && url.pathname === rule.path);
                if (lost !== -1) {
                    lose.splice(lost, 1);
                    // The work is done, but the answer never arrives
                    throw new TypeError('Failed to fetch');
                }
                return response;
            },
        ]),
    );
    return server;
}
