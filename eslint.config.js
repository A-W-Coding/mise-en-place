// eslint.config.js — mise-en-place
// ESLint flat config: ESLint's and typescript-eslint's recommended rules.
// Run with: npm run lint

import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['dist/', 'coverage/', 'node_modules/', 'postgres-data/'] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            // Express only treats a middleware as an error handler when it
            // declares all four parameters, so unused ones are prefixed with _.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
);
