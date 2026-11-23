import { describe, expect, test } from 'vitest';
import { formatMinutes, listMeta, methodSteps, recipeMeta } from './format';

describe('formatMinutes', () => {
    test.each([
        [5, '5 min'],
        [45, '45 min'],
        [60, '1 h'],
        [90, '1 h 30 min'],
        [120, '2 h'],
        [135, '2 h 15 min'],
    ])('%i minutes is "%s"', (minutes, expected) => {
        expect(formatMinutes(minutes)).toBe(expected);
    });
});

describe('listMeta and recipeMeta', () => {
    test('include only the times a recipe has', () => {
        expect(listMeta({ servings: 2, prepTime: 20, cookTime: 120 })).toBe('Serves 2 · 20 min prep · 2 h cook');
        expect(listMeta({ servings: 4, prepTime: null, cookTime: 40 })).toBe('Serves 4 · 40 min cook');
        expect(listMeta({ servings: 1, prepTime: null, cookTime: null })).toBe('Serves 1');
        expect(recipeMeta({ servings: 2, prepTime: 20, cookTime: 120 })).toBe('Serves 2 · Prep 20 min · Cook 2 h');
        expect(recipeMeta({ servings: 6, prepTime: 0, cookTime: null })).toBe('Serves 6');
    });
});

describe('methodSteps', () => {
    test('splits the instructions into lines, dropping their numbers and blank lines', () => {
        expect(methodSteps('1. Chop.\r\n2) Fry.\n\n  10. Serve.  ')).toEqual(['Chop.', 'Fry.', 'Serve.']);
    });

    test('keeps a number that is part of the step', () => {
        expect(methodSteps('Simmer for 20 minutes.\n2 eggs go in last.')).toEqual(['Simmer for 20 minutes.', '2 eggs go in last.']);
    });

    test('has no steps for no instructions', () => {
        expect(methodSteps(null)).toEqual([]);
        expect(methodSteps('')).toEqual([]);
    });
});
