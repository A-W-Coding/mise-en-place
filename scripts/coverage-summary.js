// scripts/coverage-summary.js — mise-en-place
// Prints Jest's coverage totals as a Markdown table, for the CI run's
// summary page. Reads coverage/coverage-summary.json, which the
// json-summary reporter in jest.config.js writes.
// Run with: node scripts/coverage-summary.js >> "$GITHUB_STEP_SUMMARY"

import { readFileSync } from 'node:fs';
import process from 'node:process';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const metrics = ['statements', 'branches', 'functions', 'lines'];
const cell = (m) => `${m.pct}% (${m.covered}/${m.total})`;
const row = (name, counts) => `| ${name} | ${metrics.map((k) => cell(counts[k])).join(' | ')} |`;

const { total, ...files } = summary;
const root = process.cwd().replaceAll('\\', '/') + '/';

const lines = [
    '## Test coverage',
    '',
    '| | Statements | Branches | Functions | Lines |',
    '|---|---|---|---|---|',
    row('**All files**', total),
    '',
    '<details><summary>By file</summary>',
    '',
    '| File | Statements | Branches | Functions | Lines |',
    '|---|---|---|---|---|',
    ...Object.entries(files).map(([path, counts]) => row(path.replaceAll('\\', '/').replace(root, ''), counts)),
    '',
    '</details>',
    '',
];

process.stdout.write(lines.join('\n'));
