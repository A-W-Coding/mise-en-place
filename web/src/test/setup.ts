// Vitest setup: Testing Library's DOM matchers (toBeInTheDocument and friends),
// a clean DOM after every test, and stand-ins for browser features jsdom lacks.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { MockIntersectionObserver } from './intersectionObserver';

// Assigned directly rather than with vi.stubGlobal, so a test's unstubAllGlobals() keeps them
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
window.print = vi.fn();

afterEach(() => {
    cleanup();
    MockIntersectionObserver.reset();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
