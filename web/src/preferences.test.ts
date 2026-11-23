import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_PREFERENCES, applyPreferences, loadPreferences } from './preferences';
import { ApiError } from './api/client';
import { shouldRetry } from './queryClient';

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('loadPreferences', () => {
    test('reads what was saved', () => {
        localStorage.setItem('miseenplace.preferences', JSON.stringify({ theme: 'dark', textSize: 'larger' }));
        expect(loadPreferences()).toEqual({ theme: 'dark', textSize: 'larger' });
    });

    test('falls back to the defaults for anything missing, unknown or unreadable', () => {
        expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
        localStorage.setItem('miseenplace.preferences', JSON.stringify({ theme: 'sepia' }));
        expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
        localStorage.setItem('miseenplace.preferences', '{not json');
        expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    });

    test('starts with the defaults when storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('Blocked', 'SecurityError');
        });
        expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    });
});

describe('applyPreferences', () => {
    test('sets the attributes theme.css reads, and removes them for the defaults', () => {
        const root = document.createElement('html');
        applyPreferences({ theme: 'light', textSize: 'smaller' }, root);
        expect(root.dataset).toMatchObject({ theme: 'light', textSize: 'smaller' });

        applyPreferences(DEFAULT_PREFERENCES, root);
        expect(root.dataset.theme).toBeUndefined();
        expect(root.dataset.textSize).toBeUndefined();
    });
});

describe('shouldRetry', () => {
    test('retries a failure once, but never a 4xx', () => {
        expect(shouldRetry(0, new ApiError(0, "Can't reach the server."))).toBe(true);
        expect(shouldRetry(0, new ApiError(500, 'Boom'))).toBe(true);
        expect(shouldRetry(1, new ApiError(500, 'Boom'))).toBe(false);
        expect(shouldRetry(0, new ApiError(404, 'Recipe not found.'))).toBe(false);
        expect(shouldRetry(0, new ApiError(412, 'Changed'))).toBe(false);
    });
});
