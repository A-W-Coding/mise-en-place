/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: 'ts-jest/presets/js-with-ts-esm',
    testEnvironment: 'node',
    // Only look in tests/, so the compiled copies in dist/ never run (A5).
    roots: ['<rootDir>/tests'],
    // Loads .env.test, checks for a _test database and migrates it, once per run (T1).
    globalSetup: '<rootDir>/tests/helpers/global-setup.ts',
    // Database-backed tests can be slow in CI or on the Pi.
    testTimeout: 15_000,
    // With --coverage: a table in the terminal, an HTML report in
    // coverage/lcov-report/, and totals for scripts/coverage-summary.js (CI).
    coverageReporters: ['text', 'lcov', 'json-summary'],
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            { useESM: true },
        ],
    },
};
