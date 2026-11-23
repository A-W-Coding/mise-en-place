/**
 * @module web/src/preferences
 * The theme, text size and timer sound, chosen on the Options page and saved
 * on this device only (technical spec §3.4).
 *
 * They're applied as `data-theme` and `data-text-size` on <html>, which
 * theme.css turns into colours and a root font size. "System" and "Normal"
 * remove the attribute, so the system's light or dark choice and the
 * browser's font size apply unchanged.
 *
 * Storage can be missing or blocked (a private window, say), so every read
 * and write is guarded: the app then just starts with the defaults.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type TextSize = 'smaller' | 'normal' | 'larger';

export interface Preferences {
    theme: Theme;
    textSize: TextSize;
    /** Whether a finished timer plays a sound. It vibrates either way, where the device can. */
    timerSound: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', textSize: 'normal', timerSound: true };

const STORAGE_KEY = 'miseenplace.preferences';
const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const TEXT_SIZES: readonly TextSize[] = ['smaller', 'normal', 'larger'];

/** Read the saved preferences, ignoring anything missing or unrecognised. */
export function loadPreferences(): Preferences {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<keyof Preferences, unknown>>;
        return {
            theme: THEMES.find((theme) => theme === saved.theme) ?? DEFAULT_PREFERENCES.theme,
            textSize: TEXT_SIZES.find((size) => size === saved.textSize) ?? DEFAULT_PREFERENCES.textSize,
            timerSound: typeof saved.timerSound === 'boolean' ? saved.timerSound : DEFAULT_PREFERENCES.timerSound,
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

/** Set the attributes theme.css reads. */
export function applyPreferences(preferences: Preferences, root: HTMLElement = document.documentElement): void {
    if (preferences.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = preferences.theme;

    if (preferences.textSize === 'normal') delete root.dataset.textSize;
    else root.dataset.textSize = preferences.textSize;
}

// A tiny store, so every component showing a preference sees a change at once
let current: Preferences | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Preferences {
    current ??= loadPreferences();
    return current;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Change one preference: apply it, save it, and tell every subscriber. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    current = { ...getSnapshot(), [key]: value };
    applyPreferences(current);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // Not saved, but still applied for this visit
    }
    listeners.forEach((listener) => listener());
}

/** Forget the cached copy, so the next read comes from storage again. For tests. */
export function resetPreferencesCache(): void {
    current = null;
}

/** The current preferences, outside React (the timers read the sound setting when one finishes). */
export function getPreferences(): Preferences {
    return getSnapshot();
}

/** The current preferences, and a setter, for a component. */
export function usePreferences() {
    const preferences = useSyncExternalStore(subscribe, getSnapshot);
    const set = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => setPreference(key, value), []);
    return [preferences, set] as const;
}
