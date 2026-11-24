import { describe, expect, test } from 'vitest';
import { beefChili, equipmentOn, item, section, tag, tagsOn } from '../test/fixtures';
import {
    apiBody,
    buildRecipeBody,
    draftFromBody,
    draftFromRecipe,
    draftReducer,
    equipmentErrorKey,
    hasNamedSections,
    isDirty,
    lineErrorKey,
    lineGroups,
    mapServerErrors,
    newDraft,
    sectionErrorKey,
    stepErrorKey,
    TAGS_ERROR,
    type EquipmentDraft,
    type LineDraft,
    type RecipeDraft,
    type SectionDraft,
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

/**
 * A method section as the editor holds it: a box per step, keyed after the
 * section (`m-0`, `m-1`…). A step given as `[text, seconds]` has a timer.
 */
function method(steps: (string | [string, number])[], extra: Partial<SectionDraft> = {}): SectionDraft {
    const key = extra.key ?? 'm';
    return {
        key,
        name: 'Method',
        steps: steps.map((step, index) => {
            const [text, timerSeconds] = typeof step === 'string' ? [step, null] : step;
            return { key: `${key}-${index}`, text, timerSeconds };
        }),
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
                sections: [method([' Chop. ', '', ['Simmer.', 600]])],
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
                // Each step trimmed, with its timer; an empty box is left out
                sections: [
                    {
                        name: 'Method',
                        steps: [
                            { text: 'Chop.', timerSeconds: null },
                            { text: 'Simmer.', timerSeconds: 600 },
                        ],
                    },
                ],
                ingredients: [
                    {
                        ingredientId: garlic.id,
                        ingredientName: 'garlic',
                        quantity: 2,
                        quantityMax: null,
                        unit: 'clove',
                        note: 'crushed',
                        sectionIndex: null,
                    },
                    {
                        ingredientId: onion.id,
                        ingredientName: 'onion',
                        quantity: null,
                        quantityMax: null,
                        unit: null,
                        note: null,
                        sectionIndex: null,
                    },
                ],
                tags: [],
                equipment: [],
            },
            lineKeys: ['a', 'b'],
            sectionKeys: ['m'],
            stepKeys: [['m-0', 'm-2']],
            equipmentKeys: [],
        });
    });

    test('leaves out lines with nothing in them', () => {
        const result = buildRecipeBody(draft({ lines: [line('a', '', null), line('b', '1', onion), line('c', '  ', null)] }));

        expect(result).toMatchObject({ lineKeys: ['b'] });
    });

    test('clearing a box sends null, so the field is cleared', () => {
        const result = buildRecipeBody(draft({ description: '   ', sections: [method(['  ', ' '])] }));

        // An empty method saves no sections at all, as a recipe without one has
        expect(result).toMatchObject({ body: { description: null, sections: [] }, sectionKeys: [] });
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
            { lineKeys: ['first', 'second'] },
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
            sectionIndex: null,
        });
        const ids = { ingredient: (name: string) => (name === 'sourdough' ? 'new-id' : ''), tag: () => '', equipment: () => '' };
        expect(apiBody(result.body, ids).ingredients).toEqual([
            { ingredientId: 'new-id', quantity: 200, quantityMax: null, unit: 'g', note: null, sectionIndex: null },
            { ingredientId: garlic.id, quantity: 1, quantityMax: null, unit: null, note: null, sectionIndex: null },
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

describe('sections of the method (3b)', () => {
    // A recipe the API made with two sections: a timer on one step, and a line in the second
    const twoSections = {
        ...beefChili,
        sections: [
            section(beefChili.id, 0, 'Sauce', ['Fry the onions.', ['Simmer.', 1200]]),
            section(beefChili.id, 1, 'To serve', ['Ladle out.']),
        ],
    };
    twoSections.recipeIngredients = beefChili.recipeIngredients.map((l, index) => ({
        ...l,
        sectionId: index === 0 ? twoSections.sections[1]!.id : null,
    }));

    const body = (d: RecipeDraft) => {
        const result = buildRecipeBody(d);
        if ('errors' in result) throw new Error(`Expected a body: ${JSON.stringify(result.errors)}`);
        return result;
    };

    test('a recipe with several sections opens with a box per step, and saves back as it was', () => {
        const loaded = draftFromRecipe(twoSections);

        expect(loaded.sections.map((s) => [s.name, s.steps.map((step) => [step.text, step.timerSeconds])])).toEqual([
            ['Sauce', [['Fry the onions.', null], ['Simmer.', 1200]]],
            ['To serve', [['Ladle out.', null]]],
        ]);
        const result = body(loaded);
        expect(result.body.sections).toEqual([
            {
                name: 'Sauce',
                steps: [
                    { text: 'Fry the onions.', timerSeconds: null },
                    { text: 'Simmer.', timerSeconds: 1200 },
                ],
            },
            { name: 'To serve', steps: [{ text: 'Ladle out.', timerSeconds: null }] },
        ]);
        // Lines in no section come first, as the editor and the page show them; the first line stays in "To serve"
        expect(result.body.ingredients.map((l) => l.sectionIndex)).toEqual([null, null, null, null, null, null, 1]);
        expect(result.body.ingredients[6]?.ingredientName).toBe(beefChili.recipeIngredients[0]!.ingredient.name);
    });

    test("editing a step's text keeps its timer, which only the timer sheet changes", () => {
        const loaded = draftFromRecipe(twoSections);
        const simmer = loaded.sections[0]!.steps[1]!;
        const edited = draftReducer(loaded, { type: 'step', key: simmer.key, patch: { text: 'Simmer gently.' } });
        const retimed = draftReducer(edited, { type: 'step', key: simmer.key, patch: { timerSeconds: 1500 } });
        const untimed = draftReducer(edited, { type: 'step', key: simmer.key, patch: { timerSeconds: null } });

        expect(body(edited).body.sections[0]!.steps[1]).toEqual({ text: 'Simmer gently.', timerSeconds: 1200 });
        expect(body(retimed).body.sections[0]!.steps[1]).toEqual({ text: 'Simmer gently.', timerSeconds: 1500 });
        expect(body(untimed).body.sections[0]!.steps[1]).toEqual({ text: 'Simmer gently.', timerSeconds: null });
    });

    test("a section with no steps is kept while a line is in it, and dropped once none is", () => {
        const grouping = draft({
            sections: [method(['Stir.']), method([''], { key: 'dressing', name: 'Dressing' })],
            lines: [line('a', '1', garlic, { sectionKey: 'dressing' })],
        });
        const kept = buildRecipeBody(grouping);
        const dropped = buildRecipeBody({ ...grouping, lines: [line('a', '1', garlic)] });

        expect(kept).toMatchObject({ body: { sections: [{ name: 'Method' }, { name: 'Dressing', steps: [] }] }, sectionKeys: ['m', 'dressing'] });
        expect(kept).toMatchObject({ body: { ingredients: [{ sectionIndex: 1 }] } });
        expect(dropped).toMatchObject({ body: { sections: [{ name: 'Method' }] }, sectionKeys: ['m'] });
    });

    test('a section in use needs a name, and a step over 2,000 characters is refused, before the API sees them', () => {
        const result = buildRecipeBody(
            draft({ sections: [method(['Fine.', 'x'.repeat(2001)]), method(['Toss.'], { key: 's2', name: '  ' })] }),
        );

        expect(result).toEqual({
            errors: {
                [stepErrorKey('m-1', 'text')]: 'Keep each step to 2000 characters or fewer.',
                [sectionErrorKey('s2', 'name')]: 'Give the section a name.',
            },
        });
    });

    test("the API's messages about a section or a step land on its box", () => {
        const errors = mapServerErrors(
            {
                'sections.1.steps.0.text': 'Must not be empty.',
                'sections.1.steps.1.timerSeconds': 'Must be at most 86400.',
                'sections.0.name': 'Must not be empty.',
                'sections.0.steps': 'Must be an array of steps.',
            },
            { sectionKeys: ['first', 'second'], stepKeys: [['a'], ['b', 'c']] },
        );

        expect(errors).toEqual({
            [stepErrorKey('b', 'text')]: 'Must not be empty.',
            [stepErrorKey('c', 'timer')]: 'Must be at most 86400.',
            [sectionErrorKey('first', 'name')]: 'Must not be empty.',
            [sectionErrorKey('first', 'steps')]: 'Must be an array of steps.',
        });
    });

    test('a version saved on the device reopens with its sections, timers and grouping', () => {
        const first = body(draftFromRecipe(twoSections));

        const reopened = buildRecipeBody(draftFromBody(first.body));

        expect(reopened).toMatchObject({ body: first.body });
    });

    test('a recipe whose lines came out of order opens with them grouped, no section first', () => {
        const mixed = {
            ...twoSections,
            recipeIngredients: twoSections.recipeIngredients.map((l, index) => ({
                ...l,
                sectionId: index % 2 === 0 ? twoSections.sections[0]!.id : null,
            })),
        };

        const loaded = draftFromRecipe(mixed);

        expect(loaded.lines.map((l) => l.key)).toEqual([1, 3, 5, 0, 2, 4, 6].map((i) => mixed.recipeIngredients[i]!.id));
    });

    test('lines can be put in sections once the method has a section of its own', () => {
        expect(hasNamedSections([{ name: 'Method' }])).toBe(false);
        expect(hasNamedSections([{ name: 'Sauce' }])).toBe(true);
        expect(hasNamedSections([{ name: 'Method' }, { name: 'To serve' }])).toBe(true);
        expect(hasNamedSections([])).toBe(false);
    });
});

describe('draftReducer: sections and steps (3b)', () => {
    const start = draft({
        sections: [method(['Fry.', 'Simmer.']), method(['Serve.'], { key: 'n', name: 'To serve' })],
        lines: [
            line('a', '1', garlic),
            line('b', '2', onion),
            line('c', '3', onion, { sectionKey: 'm' }),
            line('d', '4', onion, { sectionKey: 'm' }),
            line('e', '5', garlic, { sectionKey: 'n' }),
        ],
    });
    const keys = (d: RecipeDraft) => d.lines.map((l) => l.key);
    const steps = (d: RecipeDraft, index = 0) => d.sections[index]!.steps.map((step) => step.text);

    test('a line moves only within its group, and its section menu sends it to the end of the new one', () => {
        expect(keys(draftReducer(start, { type: 'move', key: 'd', by: -1 }))).toEqual(['a', 'b', 'd', 'c', 'e']);
        // The first line of a group doesn't jump into the group above
        expect(draftReducer(start, { type: 'move', key: 'c', by: -1 })).toBe(start);
        expect(draftReducer(start, { type: 'move', key: 'b', by: 1 })).toBe(start);

        const moved = draftReducer(start, { type: 'lineSection', key: 'a', sectionKey: 'm' });
        expect(keys(moved)).toEqual(['b', 'c', 'd', 'a', 'e']);
        expect(moved.lines[3]?.sectionKey).toBe('m');
        expect(keys(draftReducer(start, { type: 'lineSection', key: 'e', sectionKey: null }))).toEqual(['a', 'b', 'e', 'c', 'd']);
    });

    test('lineGroups gives each group with lines, no section first', () => {
        expect(lineGroups(start).map((group) => [group.section?.name ?? null, group.lines.map((l) => l.key)])).toEqual([
            [null, ['a', 'b']],
            ['Method', ['c', 'd']],
            ['To serve', ['e']],
        ]);
    });

    test('a new line joins the last group, just above the Add button', () => {
        const added = draftReducer(start, { type: 'add' });

        expect(added.lines[5]).toMatchObject({ sectionKey: 'n', focus: 'amount' });
    });

    test('moving a section moves its lines with it; removing one keeps its lines, in no section', () => {
        const swapped = draftReducer(start, { type: 'moveSection', key: 'n', by: -1 });
        expect(swapped.sections.map((section) => section.key)).toEqual(['n', 'm']);
        expect(keys(swapped)).toEqual(['a', 'b', 'e', 'c', 'd']);
        expect(draftReducer(start, { type: 'moveSection', key: 'm', by: -1 })).toBe(start);

        const removed = draftReducer(start, { type: 'removeSection', key: 'm' });
        expect(removed.sections.map((section) => section.key)).toEqual(['n']);
        expect(removed.lines.map((l) => [l.key, l.sectionKey ?? null])).toEqual([
            ['a', null],
            ['b', null],
            ['c', null],
            ['d', null],
            ['e', 'n'],
        ]);
    });

    test('Add section adds an empty one to name, with a box for its first step', () => {
        const added = draftReducer(start, { type: 'addSection' });

        expect(added.sections[2]).toMatchObject({ name: '', focus: true, steps: [{ text: '', timerSeconds: null }] });
    });

    test('Enter splits a step at the cursor, and the new step takes the focus', () => {
        const split = draftReducer(start, { type: 'splitStep', key: 'm-0', before: 'Fry the onions. ', after: ' Then the garlic.' });

        expect(steps(split)).toEqual(['Fry the onions.', 'Then the garlic.', 'Simmer.']);
        expect(split.sections[0]!.steps[1]?.focus).toBe(true);
        // Enter at the end makes an empty step to type in
        expect(steps(draftReducer(start, { type: 'splitStep', key: 'm-1', before: 'Simmer.', after: '' }))).toEqual(['Fry.', 'Simmer.', '']);
    });

    test('pasting several lines makes a step of each, without their numbers or blank lines', () => {
        const pasted = draftReducer(start, { type: 'pasteSteps', key: 'm-0', text: '1. Heat the oil.\n\n2) Fry the onions.\r\n3 eggs, beaten in.' });

        expect(steps(pasted)).toEqual(['Heat the oil.', 'Fry the onions.', '3 eggs, beaten in.', 'Simmer.']);
    });

    test('steps move within their section and are removed, always leaving a box to type in', () => {
        expect(steps(draftReducer(start, { type: 'moveStep', key: 'm-1', by: -1 }))).toEqual(['Simmer.', 'Fry.']);
        expect(draftReducer(start, { type: 'moveStep', key: 'm-1', by: 1 }).sections).toEqual(start.sections);
        expect(steps(draftReducer(start, { type: 'removeStep', key: 'm-0' }))).toEqual(['Simmer.']);

        const emptied = draftReducer(start, { type: 'removeStep', key: 'n-0' });
        expect(emptied.sections[1]!.steps).toMatchObject([{ text: '', focus: true }]);
    });

    test('Add step adds an empty, focused box at the end of its section', () => {
        const added = draftReducer(start, { type: 'addStep', sectionKey: 'n' });

        expect(added.sections[1]!.steps.map((step) => [step.text, step.focus ?? false])).toEqual([
            ['Serve.', false],
            ['', true],
        ]);
    });

    test('renames a section', () => {
        expect(draftReducer(start, { type: 'sectionName', key: 'n', name: 'Garnish' }).sections[1]?.name).toBe('Garnish');
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

    test("notices a step's text or timer changing, but not which box wants focus (3b)", () => {
        const start = draftFromRecipe(beefChili);
        const step = start.sections[0]!.steps[0]!;

        expect(isDirty(start, draftReducer(start, { type: 'step', key: step.key, patch: { text: 'Changed.' } }))).toBe(true);
        expect(isDirty(start, draftReducer(start, { type: 'step', key: step.key, patch: { timerSeconds: 60 } }))).toBe(true);
        const focused = { ...start, sections: start.sections.map((s) => ({ ...s, focus: true, steps: s.steps.map((st) => ({ ...st, focus: true })) })) };
        expect(isDirty(start, focused)).toBe(false);
    });
});

describe('tags and equipment (3b)', () => {
    const beef = tag('beef', '#f6c7bd');
    const spicy = tag('spicy');
    const pan = item('large pan');
    const spoon = item('wooden spoon');
    const recipe = {
        ...beefChili,
        tags: tagsOn(beefChili.id, [spicy, beef]),
        equipment: equipmentOn(beefChili.id, [[pan, 2], [spoon, 1, true]]),
    };
    const body = (d: RecipeDraft) => {
        const result = buildRecipeBody(d);
        if ('errors' in result) throw new Error(`Expected a body: ${JSON.stringify(result.errors)}`);
        return result;
    };
    const line = (key: string, extra: Partial<EquipmentDraft> = {}): EquipmentDraft => ({
        key,
        item: null,
        itemText: '',
        quantity: 1,
        optional: false,
        ...extra,
    });

    test('a recipe opens with its tags in order and its equipment lines, and saves them back as they were', () => {
        const loaded = draftFromRecipe(recipe);

        expect(loaded.tags).toEqual([
            { id: spicy.id, name: 'spicy', color: null },
            { id: beef.id, name: 'beef', color: '#f6c7bd' },
        ]);
        expect(loaded.equipment.map((l) => [l.itemText, l.quantity, l.optional])).toEqual([
            ['large pan', 2, false],
            ['wooden spoon', 1, true],
        ]);
        const saved = body(loaded);
        expect(saved.body.tags).toEqual([
            { tagId: spicy.id, name: 'spicy', color: null },
            { tagId: beef.id, name: 'beef', color: '#f6c7bd' },
        ]);
        expect(saved.body.equipment).toEqual([
            { equipmentId: pan.id, name: 'large pan', quantity: 2, optional: false },
            { equipmentId: spoon.id, name: 'wooden spoon', quantity: 1, optional: true },
        ]);
        expect(saved.equipmentKeys).toEqual(loaded.equipment.map((l) => l.key));
        // And a version kept on the device reopens the same
        expect(buildRecipeBody(draftFromBody(saved.body))).toMatchObject({ body: saved.body });
    });

    test('apiBody sends tags and items by id, new ones once created', () => {
        const draft = draftReducer(draftFromRecipe(recipe), { type: 'addTag', tag: { id: null, name: 'weeknight', color: '#1f4e79' } });
        const withNewItem = draftReducer(draft, {
            type: 'equipment',
            key: draft.equipment[0]!.key,
            patch: { item: { id: null, name: 'wok' } },
        });

        const sent = apiBody(body(withNewItem).body, {
            ingredient: () => 'x',
            tag: (name) => `tag-${name}`,
            equipment: (name) => `item-${name}`,
        });

        expect(sent.tagIds).toEqual([spicy.id, beef.id, 'tag-weeknight']);
        expect(sent.equipment).toEqual([
            { equipmentId: 'item-wok', quantity: 2, optional: false },
            { equipmentId: spoon.id, quantity: 1, optional: true },
        ]);
        expect(sent).not.toHaveProperty('tags');
    });

    test('a tag is added once, at the end, and removed by name', () => {
        const start = draftFromRecipe(recipe);
        const added = draftReducer(start, { type: 'addTag', tag: { id: 'w', name: 'weeknight', color: null } });

        expect(added.tags.map((t) => t.name)).toEqual(['spicy', 'beef', 'weeknight']);
        expect(draftReducer(added, { type: 'addTag', tag: { id: 'w', name: 'weeknight', color: null } })).toBe(added);
        expect(draftReducer(added, { type: 'removeTag', name: 'spicy' }).tags.map((t) => t.name)).toEqual(['beef', 'weeknight']);
    });

    test('equipment lines are added, changed, moved and removed', () => {
        const start = draftFromRecipe(recipe);
        const [first, second] = start.equipment;

        const added = draftReducer(start, { type: 'addEquipment' });
        expect(added.equipment[2]).toMatchObject({ item: null, itemText: '', quantity: 1, optional: false, focus: true });

        const counted = draftReducer(start, { type: 'equipment', key: first!.key, patch: { quantity: 3, optional: true } });
        expect(counted.equipment[0]).toMatchObject({ quantity: 3, optional: true });

        expect(draftReducer(start, { type: 'moveEquipment', key: second!.key, by: -1 }).equipment.map((l) => l.itemText)).toEqual([
            'wooden spoon',
            'large pan',
        ]);
        expect(draftReducer(start, { type: 'moveEquipment', key: first!.key, by: -1 })).toBe(start);
        expect(draftReducer(start, { type: 'removeEquipment', key: first!.key }).equipment).toHaveLength(1);
    });

    test('typing in an Item box unpicks the item unless it still names it', () => {
        const start = draftFromRecipe(recipe);
        const key = start.equipment[0]!.key;

        expect(draftReducer(start, { type: 'equipmentText', key, text: 'Large Pan ' }).equipment[0]?.item).toEqual({
            id: pan.id,
            name: 'large pan',
        });
        expect(draftReducer(start, { type: 'equipmentText', key, text: 'large' }).equipment[0]).toMatchObject({
            item: null,
            itemText: 'large',
        });
    });

    test('an empty equipment line is left out; one typed but not chosen, or a long new tag, is refused', () => {
        const draft = { ...draftFromRecipe(beefChili), equipment: [line('blank'), line('typed', { itemText: 'wok' })] };
        const longTag = { ...draftFromRecipe(beefChili), tags: [{ id: null, name: 'x'.repeat(51), color: null }] };

        expect(buildRecipeBody(draft)).toEqual({
            errors: { [equipmentErrorKey('typed', 'item')]: 'Choose “wok” from the list, or create it.' },
        });
        expect(buildRecipeBody({ ...draft, equipment: [line('blank')] })).toMatchObject({ body: { equipment: [] }, equipmentKeys: [] });
        expect(buildRecipeBody(longTag)).toEqual({ errors: { [TAGS_ERROR]: "Keep each tag's name to 50 characters or fewer." } });
    });

    test("the API's messages about tags and equipment land beside them", () => {
        const errors = mapServerErrors(
            {
                'tagIds.1': 'Each tag only once.',
                'equipment.1.quantity': 'Must be at most 99.',
                'equipment.0.equipmentId': 'Must be an equipment id.',
            },
            { equipmentKeys: ['a', 'b'] },
        );

        expect(errors).toEqual({
            [TAGS_ERROR]: 'Each tag only once.',
            [equipmentErrorKey('b', 'quantity')]: 'Must be at most 99.',
            [equipmentErrorKey('a', 'item')]: 'Must be an equipment id.',
        });
    });

    test('notices a tag or equipment line changing, but not focus', () => {
        const start = draftFromRecipe(recipe);

        expect(isDirty(start, draftReducer(start, { type: 'removeTag', name: 'beef' }))).toBe(true);
        expect(isDirty(start, draftReducer(start, { type: 'equipment', key: start.equipment[0]!.key, patch: { optional: true } }))).toBe(true);
        expect(isDirty(start, { ...start, equipment: start.equipment.map((l) => ({ ...l, focus: true })) })).toBe(false);
    });
});
