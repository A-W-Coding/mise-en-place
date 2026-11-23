// Vitest setup: Testing Library's DOM matchers (toBeInTheDocument and friends),
// a clean DOM after every test, and stand-ins for browser features jsdom lacks.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetPreferencesCache } from '../preferences';
import { resetTimers } from '../timers/timerStore';
import { MockIntersectionObserver } from './intersectionObserver';

// Assigned directly rather than with vi.stubGlobal, so a test's unstubAllGlobals() keeps them
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
window.print = vi.fn();

// jsdom has <dialog> but not its methods: enough of them for ConfirmDialog
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'open', {
        configurable: true,
        get(this: HTMLDialogElement) {
            return this.hasAttribute('open');
        },
    });
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
    };
}

afterEach(() => {
    cleanup();
    MockIntersectionObserver.reset();
    // The timers and preferences live outside React, so each test starts them afresh
    resetTimers();
    localStorage.clear();
    resetPreferencesCache();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
