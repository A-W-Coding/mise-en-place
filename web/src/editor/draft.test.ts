import { describe, expect, test } from 'vitest';
import { beefChili } from '../test/fixtures';
import {
    apiBody,
    buildRecipeBody,
    draftFromBody,
    draftFromRecipe,
    draftReducer,
    isDirty,
    lineErrorKey,
    mapServerErrors,
    newDraft,
    type LineDraft,
    type RecipeDraft,
} from './draft';

const garlic = { id: '11111111-1111-4111-8111-111111111111', name: 'garlic' };
const onion = { id: '22222222-2222-4222-8222-222222222222', name: 'onion' };

function line(key: string, amount: string, ingredient: LineDraft['ingredient'], extra: Partial<LineDraft> = {}): LineDraft {
    return {
        key,
        amount,
        ingredient,
        ingredientText: ingredient?.name ?? '',
        note: '',
        showNote: false,
        ...extra,
    };
}

function draft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
    return { ...newDraft(), name: 'Soup', lines: [], ...overrides };
}

describe('buildRecipeBody', () => {
    test('turns what was typed into what is saved, each line naming its ingredient', () => {
        const result = buildRecipeBody(
            draft({
                name: '  Garlic Soup ',
                description: ' Warming ',
                servings: '2',
                prepTime: '10',
                cookTime: '',
                instructions: 'Chop.\nSimmer.',
                lines: [
                    line('a', '2 cloves', garlic, { note: ' crushed ', showNote: true }),
                    line('b', '', onion),
                ],
            }),
        );

        expect(result).toEqual({
            body: {
                name: 'Garlic Soup',
                description: 'Warming',
                servings: 2,
                prepTime: 10,
                cookTime: null,
                instructions: 'Chop.\nSimmer.',
                ingredients: [
                    {
                        ingredientId: garlic.id,
                        ingredientName: 'garlic',
                        quantity: 2,
                        quantityMax: null,
                        unit: 'clove',
                        note: 'crushed',
                    },
                    { ingredientId: onion.id, ingredientName: 'onion', quantity: null, quantityMax: null, unit: null, note: null },
                ],
            },
            lineKeys: ['a', 'b'],
        });
    });

    test('leaves out lines with nothing in them', () => {
        const result = buildRecipeBody(draft({ lines: [line('a', '', null), line('b', '1', onion), line('c', '  ', null)] }));

        expect(result).toMatchObject({ lineKeys: ['b'] });
    });

    test('clearing a box sends null, so the field is cleared', () => {
        const result = buildRecipeBody(draft({ description: '   ', instructions: '' }));

        expect(result).toMatchObject({ body: { description: null, instructions: null } });
    });

    test('an untouched amount sends the numbers it was saved with, not the rounded ones shown', () => {
        const saved = { amount: '⅓ cup', quantity: 0.33, quantityMax: null, unit: 'cup' };
        const untouched = buildRecipeBody(draft({ lines: [line('a', '⅓ cup', onion, { saved })] }));
        const edited = buildRecipeBody(draft({ lines: [line('a', '½ cup', onion, { saved })] }));

        expect(untouched).toMatchObject({ body: { ingredients: [{ quantity: 0.33, unit: 'cup' }] } });
        expect(edited).toMatchObject({ body: { ingredients: [{ quantity: 0.5, unit: 'cup' }] } });
    });

    test('reports every problem at once, next to its box', () => {
        const result = buildRecipeBody(
            draft({
                name: ' ',
                servings: '0',
                prepTime: '1.5',
                cookTime: 'soon',
                lines: [line('a', '3 eggs', null, { ingredientText: 'egg' }), line('b', '1', null, { ingredientText: '' })],
            }),
        );

        expect(result).toEqual({
            errors: {
                name: 'Give the recipe a name.',
                servings: 'A whole number from 1 to 1000.',
                prepTime: 'Whole minutes, up to 99999, or leave it empty.',
                cookTime: 'Whole minutes, up to 99999, or leave it empty.',
                [lineErrorKey('a', 'amount')]: '“eggs” isn\'t a unit. For a count, type just the number.',
                [lineErrorKey('a', 'ingredient')]: 'Choose “egg” from the list, or create it.',
                [lineErrorKey('b', 'ingredient')]: 'Choose an ingredient.',
            },
        });
    });

    test('a long note is refused before the API sees it', () => {
        const result = buildRecipeBody(draft({ lines: [line('a', '1', onion, { note: 'x'.repeat(201), showNote: true })] }));

        expect(result).toEqual({ errors: { [lineErrorKey('a', 'note')]: 'Keep the note to 200 characters or fewer.' } });
    });
});

describe('mapServerErrors', () => {
    test("puts each of the API's messages next to its box", () => {
        const errors = mapServerErrors(
            {
                name: 'Must be at most 200 characters.',
                'ingredients.1.unit': 'Unknown unit "x".',
                'ingredients.0.ingredientId': 'Must be an ingredient id.',
                'ingredients.1.note': 'Too long.',
                mystery: 'Odd.',
            },
            ['first', 'second'],
        );

        expect(errors).toEqual({
            name: 'Must be at most 200 characters.',
            [lineErrorKey('second', 'amount')]: 'Unknown unit "x".',
            [lineErrorKey('first', 'ingredient')]: 'Must be an ingredient id.',
            [lineErrorKey('second', 'note')]: 'Too long.',
            form: 'mystery: Odd.',
        });
    });
});

describe('buildRecipeBody: the limits the API shares (3c)', () => {
    test('refuses servings and times beyond what the API accepts, so an offline save is rarely refused later', () => {
        const result = buildRecipeBody(draft({ servings: '1001', prepTime: '100000', cookTime: '99999' }));

        expect(result).toEqual({
            errors: {
                servings: 'A whole number from 1 to 1000.',
                prepTime: 'Whole minutes, up to 99999, or leave it empty.',
            },
        });
        expect(buildRecipeBody(draft({ servings: '1000', prepTime: '0' }))).not.toHaveProperty('errors');
    });

    test("holds a new ingredient's name to the API's length", () => {
        const long = 'x'.repeat(101);
        const result = buildRecipeBody(draft({ lines: [line('a', '1', { id: null, name: long })] }));

        expect(result).toEqual({
            errors: { [lineErrorKey('a', 'ingredient')]: "Keep the ingredient's name to 100 characters or fewer." },
        });
    });
});

describe('a new ingredient picked offline', () => {
    test('is saved by name with no id, and apiBody fills in its id once it exists', () => {
        const result = buildRecipeBody(
            draft({ lines: [line('a', '200 g', { id: null, name: 'sourdough' }), line('b', '1', garlic)] }),
        );
        if ('errors' in result) throw new Error('Expected a body.');

        expect(result.body.ingredients[0]).toEqual({
            ingredientId: null,
            ingredientName: 'sourdough',
            quantity: 200,
            quantityMax: null,
            unit: 'g',
            note: null,
        });
        expect(apiBody(result.body, (name) => (name === 'sourdough' ? 'new-id' : '')).ingredients).toEqual([
            { ingredientId: 'new-id', quantity: 200, quantityMax: null, unit: 'g', note: null },
            { ingredientId: garlic.id, quantity: 1, quantityMax: null, unit: null, note: null },
        ]);
    });
});

describe('draftFromBody', () => {
    test('reopens a version saved on the device exactly as it was saved', () => {
        const first = buildRecipeBody(
            draft({ lines: [line('a', '1–2 tsp', garlic), line('b', '3', { id: null, name: 'sourdough' })] }),
        );
        if ('errors' in first) throw new Error('Expected a body.');

        const reopened = draftFromBody(first.body);

        expect(reopened.lines.map((l) => [l.amount, l.ingredient, l.ingredientText])).toEqual([
            ['1–2 tsp', garlic, 'garlic'],
            ['3', { id: null, name: 'sourdough' }, 'sourdough'],
        ]);
        expect(buildRecipeBody(reopened)).toMatchObject({ body: first.body });
    });
});

describe('draftFromRecipe', () => {
    test("shows a saved recipe's lines as the recipe page does, remembering their numbers", () => {
        const loaded = draftFromRecipe(beefChili);

        expect(loaded).toMatchObject({ name: 'Beef Chili', servings: '2', prepTime: '20', cookTime: '120' });
        expect(loaded.lines.map((l) => [l.amount, l.ingredientText, l.note, l.showNote])).toEqual([
            ['1', 'onion', 'diced', true],
            ['½', 'red pepper', 'diced', true],
            ['1 clove', 'garlic', 'chopped', true],
            ['1–2 tsp', 'smoked paprika', '', false],
            ['', 'cayenne pepper', 'to taste', true],
            ['500 g', 'beef mince', '', false],
            ['2 cans', 'sweetcorn', 'drained', true],
        ]);
        expect(loaded.lines[3]?.saved).toEqual({ amount: '1–2 tsp', quantity: 1, quantityMax: 2, unit: 'tsp' });
        // And it saves back exactly as it was
        expect(buildRecipeBody(loaded)).toMatchObject({
            body: {
                ingredients: beefChili.recipeIngredients.map((l) => ({
                    ingredientId: l.ingredientId,
                    quantity: l.quantity,
                    quantityMax: l.quantityMax,
                    unit: l.unit,
                    note: l.note,
                })),
            },
        });
    });
});

describe('draftReducer', () => {
    const start = draft({ lines: [line('a', '1', garlic), line('b', '2', onion), line('c', '3', onion)] });
    const keys = (d: RecipeDraft) => d.lines.map((l) => l.key);

    test('moves a line up or down, and not past either end', () => {
        expect(keys(draftReducer(start, { type: 'move', key: 'b', by: -1 }))).toEqual(['b', 'a', 'c']);
        expect(keys(draftReducer(start, { type: 'move', key: 'b', by: 1 }))).toEqual(['a', 'c', 'b']);
        expect(draftReducer(start, { type: 'move', key: 'a', by: -1 })).toBe(start);
        expect(draftReducer(start, { type: 'move', key: 'c', by: 1 })).toBe(start);
    });

    test('adds an empty line at the end, focused, and removes one', () => {
        const added = draftReducer(start, { type: 'add' });
        expect(added.lines).toHaveLength(4);
        expect(added.lines[3]).toMatchObject({ amount: '', ingredient: null, focus: 'amount' });
        expect(keys(draftReducer(start, { type: 'remove', key: 'b' }))).toEqual(['a', 'c']);
    });

    test('typing in the Ingredient box unpicks the ingredient unless it still names it', () => {
        const retyped = draftReducer(start, { type: 'ingredientText', key: 'a', text: 'Garlic ' });
        const changed = draftReducer(start, { type: 'ingredientText', key: 'a', text: 'garli' });

        expect(retyped.lines[0]?.ingredient).toEqual(garlic);
        expect(changed.lines[0]).toMatchObject({ ingredient: null, ingredientText: 'garli' });
    });
});

describe('isDirty', () => {
    test('notices any change, including a reorder, but not focus', () => {
        const start = draftFromRecipe(beefChili);

        expect(isDirty(start, start)).toBe(false);
        expect(isDirty(start, { ...start, lines: start.lines.map((l) => ({ ...l, focus: 'note' as const })) })).toBe(false);
        expect(isDirty(start, draftReducer(start, { type: 'field', field: 'servings', value: '3' }))).toBe(true);
        expect(isDirty(start, draftReducer(start, { type: 'move', key: start.lines[0]!.key, by: 1 }))).toBe(true);
    });
});
