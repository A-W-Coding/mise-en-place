/**
 * @module tests/health.test
 * Integration tests for GET /api/health (A6).
 *
 * The outage case swaps out the Prisma client's `$queryRaw` for one that
 * fails, which is cheaper and more reliable than stopping the database.
 */

import supertest from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';

const request = supertest(app);

describe('Health check', () => {
    afterAll(async () => {
        await prisma.$disconnect();
    });

    test('should return 200 { status: "ok" } when the database answers', async () => {
        const response = await request.get('/api/health');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
    });

    test('should return 503 { status: "error" }, with no details, when the database fails', async () => {
        const realQueryRaw = prisma.$queryRaw;
        const realConsoleError = console.error;
        prisma.$queryRaw = (() =>
            Promise.reject(new Error("Can't reach database server at `db.internal:5432`"))) as unknown as typeof prisma.$queryRaw;
        console.error = () => {}; // the route logs the error; keep the test output clean

        try {
            const response = await request.get('/api/health');

            expect(response.status).toBe(503);
            expect(response.body).toEqual({ status: 'error' });
        } finally {
            prisma.$queryRaw = realQueryRaw;
            console.error = realConsoleError;
        }
    });

    // GET / was the health check before Phase 1. It now belongs to the web client:
    // its page when web/dist is built, else a 404. Either way, not a health answer.
    test('should not answer GET / as a health check', async () => {
        const response = await request.get('/');

        expect(response.type).not.toBe('application/json');
        expect(response.body).not.toEqual({ status: 'ok' });
    });
});
