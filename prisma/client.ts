/**
 * @module prisma/client
 * Singleton PrismaClient instance shared across the application.
 *
 * Import from here rather than constructing new PrismaClient() elsewhere
 * to avoid multiple connection pools in development or test.
 *
 * `Recipe.instructions` is left out of every read (Prisma's global `omit`).
 * A migration moved its text into sections and steps (3b, spec §7.2), and
 * nothing reads it now; a later migration drops the column (Step 26). Until
 * then, leaving it out here means no response can carry it by accident.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ omit: { recipe: { instructions: true } } });

/** The shared client's type, with its omissions, for code that's handed it (the seed). */
export type Database = typeof prisma;

export { prisma };
