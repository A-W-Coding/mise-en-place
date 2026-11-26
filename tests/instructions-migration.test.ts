/**
 * The migration that moved Phase 1's method text into sections and steps
 * (3b, spec §7.2). It ran once on the Pi, against real recipes (Step 26),
 * and a later migration then dropped `Recipe.instructions`.
 *
 * The test still runs the migration file's own SQL, so its rules stay
 * written down and checked. The column is gone, so each test puts it back
 * inside a transaction, makes recipes with text, runs the SQL, reads the
 * sections and steps it made, then rolls everything back: the column, the
 * recipes and the steps. Postgres can roll back a table change like any
 * other, so nothing leaks into the other tests.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const migrations = join(process.cwd(), 'prisma', 'migrations');
const folder = readdirSync(migrations).find((name) => name.endsWith('_instructions_to_steps'));
if (!folder) throw new Error('The instructions_to_steps migration is missing.');
const MOVE_INSTRUCTIONS = readFileSync(join(migrations, folder, 'migration.sql'), 'utf8');

/** Thrown at the end of each test's transaction, so it rolls back. */
class RollBack extends Error {}

type Tx = Prisma.TransactionClient;

/** Run `work` with `Recipe.instructions` back in place, then undo all of it. */
async function withInstructionsColumn(work: (tx: Tx) => Promise<void>): Promise<void> {
    await expect(
        prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('ALTER TABLE "Recipe" ADD COLUMN "instructions" TEXT');
            await work(tx);
            throw new RollBack();
        }),
    ).rejects.toBeInstanceOf(RollBack);
}

/** A recipe made as Phase 1 would have, with its method as text. */
async function recipeWithText(tx: Tx, name: string, instructions: string | null): Promise<string> {
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO "Recipe" ("id", "name", "instructions", "updatedAt") VALUES (${id}, ${name}, ${instructions}, now())`;
    return id;
}

/** A recipe's method as the migration left it: each section's name, with its steps' text. */
async function methodOf(tx: Tx, id: string) {
    const sections = await tx.recipeSection.findMany({
        where: { recipeId: id },
        include: { steps: { orderBy: { orderIndex: 'asc' } } },
        orderBy: { orderIndex: 'asc' },
    });
    return sections.map((section) => ({
        name: section.name,
        orderIndex: section.orderIndex,
        steps: section.steps.map((step) => [step.orderIndex, step.text, step.timerSeconds]),
    }));
}

describe('the instructions_to_steps migration', () => {
    setupTestLifecycle();

    test('gives a recipe with instructions one "Method" section, a step per line, in order', async () => {
        await withInstructionsColumn(async (tx) => {
            const id = await recipeWithText(tx, 'Soup', '1. Heat the oil.\r\n\r\n  2) Add the onions, and stir.  \n3 eggs, beaten in.\n10. Serve hot.\n   \n');

            await tx.$executeRawUnsafe(MOVE_INSTRUCTIONS);

            expect(await methodOf(tx, id)).toEqual([
                {
                    name: 'Method',
                    orderIndex: 0,
                    steps: [
                        // Numbered as the recipe page showed them: "1." and "2)" go, "3 eggs" stays
                        [0, 'Heat the oil.', null],
                        [1, 'Add the onions, and stir.', null],
                        [2, '3 eggs, beaten in.', null],
                        [3, 'Serve hot.', null],
                    ],
                },
            ]);
        });
    });

    test('gives no section to a recipe with no instructions, or none left once blank lines go', async () => {
        await withInstructionsColumn(async (tx) => {
            const none = await recipeWithText(tx, 'Toast', null);
            const blank = await recipeWithText(tx, 'Air', '\n   \n1.\n');

            await tx.$executeRawUnsafe(MOVE_INSTRUCTIONS);

            expect(await methodOf(tx, none)).toEqual([]);
            expect(await methodOf(tx, blank)).toEqual([]);
        });
    });

    test('leaves the text where it was, and recipes made with sections alone', async () => {
        await withInstructionsColumn(async (tx) => {
            const text = '1. Heat the oil.';
            const id = await recipeWithText(tx, 'Soup', text);
            const seeded = await tx.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
            const before = await methodOf(tx, seeded.id);

            await tx.$executeRawUnsafe(MOVE_INSTRUCTIONS);

            const rows = await tx.$queryRaw<{ instructions: string }[]>`SELECT "instructions" FROM "Recipe" WHERE "id" = ${id}`;
            expect(rows[0]?.instructions).toBe(text);
            expect(await methodOf(tx, seeded.id)).toEqual(before);
        });
    });

    test('the column is gone for good, outside these tests (Step 26)', async () => {
        const columns = await prisma.$queryRaw<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'Recipe' AND column_name = 'instructions'`;

        expect(columns).toEqual([]);
    });
});
