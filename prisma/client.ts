/**
 * @module prisma/client
 * Singleton PrismaClient instance shared across the application.
 *
 * Import from here rather than constructing new PrismaClient() elsewhere
 * to avoid multiple connection pools in development or test.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The shared client's type, for code that's handed it (the seed). */
export type Database = typeof prisma;

export { prisma };
