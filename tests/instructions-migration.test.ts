/**
 * The migration that moves Phase 1's method text into sections and steps
 * (3b, spec §7.2). It runs once, on the Pi, against real recipes, so this
 * runs the migration file's own SQL against recipes made with instructions,
 * and checks the sections and steps it makes.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../prisma/client.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const migrations = join(process.cwd(), 'prisma', 'migrations');
const folder = readdirSync(migrations).find((name) => name.endsWith('_instructions_to_steps'));
if (!folder) throw new Error('The instructions_to_steps migration is missing.');
const MOVE_INSTRUCTIONS = readFileSync(join(migrations, folder, 'migration.sql'), 'utf8');

/** A recipe's method as the migration left it: each section's name, with its steps' text. */
async function methodOf(id: string) {
    const sections = await prisma.recipeSection.findMany({
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
        const recipe = await prisma.recipe.create({
            data: {
                name: 'Soup',
                instructions: '1. Heat the oil.\r\n\r\n  2) Add the onions, and stir.  \n3 eggs, beaten in.\n10. Serve hot.\n   \n',
            },
        });

        await prisma.$executeRawUnsafe(MOVE_INSTRUCTIONS);

        expect(await methodOf(recipe.id)).toEqual([
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

    test('gives no section to a recipe with no instructions, or none left once blank lines go', async () => {
        const none = await prisma.recipe.create({ data: { name: 'Toast' } });
        const blank = await prisma.recipe.create({ data: { name: 'Air', instructions: '\n   \n1.\n' } });

        await prisma.$executeRawUnsafe(MOVE_INSTRUCTIONS);

        expect(await methodOf(none.id)).toEqual([]);
        expect(await methodOf(blank.id)).toEqual([]);
    });

    test('leaves the text where it was, and recipes made with sections alone', async () => {
        const text = '1. Heat the oil.';
        const recipe = await prisma.recipe.create({ data: { name: 'Soup', instructions: text } });
        const seeded = await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } });
        const before = await methodOf(seeded.id);

        await prisma.$executeRawUnsafe(MOVE_INSTRUCTIONS);

        // The column is left out of every read, so it's read back by hand
        const rows = await prisma.$queryRaw<{ instructions: string }[]>`SELECT "instructions" FROM "Recipe" WHERE "id" = ${recipe.id}`;
        expect(rows[0]?.instructions).toBe(text);
        expect(await methodOf(seeded.id)).toEqual(before);
    });
});
