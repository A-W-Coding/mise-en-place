/**
 * @module tests/pagination.test
 * Integration tests for paging and ordering on both list endpoints:
 * `limit`, `offset`, the `X-Total-Count` header (D6), validation of the
 * paging parameters, and a stable default order (A7).
 */

import supertest from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

interface Named {
    id: string;
    name: string;
}

/** The API's default order: name, then id. Plain comparison is fine for these ASCII names. */
function byNameThenId(a: Named, b: Named): number {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Fetch every item from a list endpoint, one small page at a time. */
async function fetchInPages(path: string, limit: number): Promise<Named[]> {
    const items: Named[] = [];
    for (let offset = 0; ; offset += limit) {
        const page = await request.get(`${path}?limit=${limit}&offset=${offset}`);
        items.push(...page.body);
        if (page.body.length < limit) return items;
    }
}

describe('Pagination and ordering', () => {
    setupTestLifecycle();

    // Runs after the lifecycle's reset. The seed has one recipe; add five more,
    // three with the same name, so their order depends on the id tie-break.
    beforeEach(async () => {
        await prisma.recipe.createMany({
            data: [
                { name: 'Zucchini Bread' },
                { name: 'Same Name' },
                { name: 'Apple Crumble' },
                { name: 'Same Name' },
                { name: 'Same Name' },
            ],
        });
    });

    describe.each([
        ['/api/ingredients', () => prisma.ingredient.count()],
        ['/api/recipes', () => prisma.recipe.count()],
    ])('%s', (path, countRows) => {
        test('should send X-Total-Count and return the first page by default', async () => {
            const total = await countRows();

            const response = await request.get(path);

            expect(response.status).toBe(200);
            expect(response.headers['x-total-count']).toBe(String(total));
            expect(response.body).toHaveLength(Math.min(total, 50));
        });

        test('should return the page that limit and offset select', async () => {
            const all = await request.get(`${path}?limit=100`);

            const page = await request.get(`${path}?limit=2&offset=1`);

            expect(page.status).toBe(200);
            expect(page.body).toEqual(all.body.slice(1, 3));
            expect(page.headers['x-total-count']).toBe(String(all.body.length));
        });

        test('should return an empty page past the end, with the total', async () => {
            const page = await request.get(`${path}?offset=1000`);

            expect(page.status).toBe(200);
            expect(page.body).toEqual([]);
            expect(page.headers['x-total-count']).toBe(String(await countRows()));
        });

        test('should order by name, then id, so paging has no gaps or repeats', async () => {
            const all: Named[] = (await request.get(`${path}?limit=100`)).body;

            expect(all).toEqual([...all].sort(byNameThenId));
            expect(await fetchInPages(path, 2)).toEqual(all);
        });

        test('should accept limit=100 and reject limit=101', async () => {
            expect((await request.get(`${path}?limit=100`)).status).toBe(200);

            const tooMany = await request.get(`${path}?limit=101`);
            expect(tooMany.status).toBe(400);
            expect(tooMany.body.fields).toEqual({ limit: 'Must be at most 100.' });
        });

        test.each([
            'limit=-1',
            'limit=1.5',
            'limit=abc',
            'limit=',
            'limit=1&limit=2',
            'offset=-1',
            'offset=abc',
            'page=2',
        ])('should return 400 for ?%s', async (query) => {
            const response = await request.get(`${path}?${query}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Validation failed.');
        });
    });

    describe('search results', () => {
        test('should page ranked results, breaking ties by name and then id', async () => {
            // The three "Same Name" recipes score the same, so only the tie-break orders them.
            const sameNames = await prisma.recipe.findMany({
                where: { name: 'Same Name' },
                orderBy: { id: 'asc' },
            });

            const first = await request.get('/api/recipes?search=same%20name&limit=2');
            const second = await request.get('/api/recipes?search=same%20name&limit=2&offset=2');

            expect(first.headers['x-total-count']).toBe('3');
            const ids = [...first.body, ...second.body].map((r: Named) => r.id);
            expect(ids).toEqual(sameNames.map((r) => r.id));
        });
    });
});
