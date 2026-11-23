// Vitest setup: Testing Library's DOM matchers (toBeInTheDocument and friends),
// and a clean DOM after every test.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
    cleanup();
});
