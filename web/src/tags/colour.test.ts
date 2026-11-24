import { describe, expect, test } from 'vitest';
import { DARK_TEXT, LIGHT_TEXT, luminance, pillColours, readableText, tagLabel, TAG_PRESETS } from './colour';

describe('readableText', () => {
    test('puts dark text on light colours, and white on dark ones', () => {
        expect(readableText('#f6c7bd')).toBe(DARK_TEXT);
        expect(readableText('#ffffff')).toBe(DARK_TEXT);
        expect(readableText('#f7e8a6')).toBe(DARK_TEXT);
        expect(readableText('#1f4e79')).toBe(LIGHT_TEXT);
        expect(readableText('#000000')).toBe(LIGHT_TEXT);
        expect(readableText('#b42318')).toBe(LIGHT_TEXT);
    });

    test('every preset reads with dark text', () => {
        for (const preset of TAG_PRESETS) expect(readableText(preset.hex)).toBe(DARK_TEXT);
    });

    test('the text it picks always meets WCAG AA for its size (4.5:1), for any colour', () => {
        const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        for (let value = 0; value <= 0xffffff; value += 0x0f0f0f) {
            const hex = `#${value.toString(16).padStart(6, '0')}`;
            const text = readableText(hex);
            // The better of the two is always at least 4.5:1 against any background
            expect(ratio(luminance(hex), luminance(text))).toBeGreaterThanOrEqual(4.5);
        }
    });
});

describe('pillColours', () => {
    test("uses the tag's colour, and the theme's quiet surface for none", () => {
        expect(pillColours('#1f4e79')).toEqual({ background: '#1f4e79', color: LIGHT_TEXT });
        expect(pillColours(null)).toEqual({ background: 'var(--surface2)', color: 'var(--text)' });
        expect(pillColours('green')).toEqual({ background: 'var(--surface2)', color: 'var(--text)' });
    });
});

describe('tagLabel', () => {
    test('shows a stored name with a capital first letter', () => {
        expect(tagLabel('weeknight')).toBe('Weeknight');
        expect(tagLabel('red meat')).toBe('Red meat');
        expect(tagLabel('')).toBe('');
    });
});
