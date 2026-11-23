// eslint.config.js — the Mise en place web client
// ESLint's and typescript-eslint's recommended rules, the React hooks rules,
// and react-refresh's check that component files only export components.
// Run with: npm run lint (in web/), or npm run web:lint from the repo root.

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    globalIgnores(['dist', 'playwright-report', 'test-results', 'blob-report']),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
        },
    },
    {
        // Playwright's config and tests run in Node, not the browser
        files: ['playwright.config.ts', 'e2e/**/*.ts'],
        languageOptions: { globals: globals.node },
    },
]);
