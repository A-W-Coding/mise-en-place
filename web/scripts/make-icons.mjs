// make-icons.mjs — renders the app's icons from the SVGs in web/icons/.
//
// Run it after changing an icon (from web/):   node scripts/make-icons.mjs
//
// It draws each SVG in Playwright's Chromium, which is already installed for
// the end-to-end tests, so it needs no image library. The PNGs it writes to
// public/ are committed, so a build doesn't need a browser.

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const OUTPUTS = [
    // [source, output, size in pixels, transparent corners?]
    ['icons/icon.svg', 'public/icon-192.png', 192, true],
    ['icons/icon.svg', 'public/icon-512.png', 512, true],
    ['icons/icon-maskable.svg', 'public/icon-maskable-512.png', 512, false],
    // iOS rounds its own corners and dislikes transparency, so it gets the full square
    ['icons/icon-maskable.svg', 'public/apple-touch-icon.png', 180, false],
];

await mkdir('public', { recursive: true });
const browser = await chromium.launch();
try {
    for (const [source, output, size, transparent] of OUTPUTS) {
        const svg = await readFile(source, 'utf8');
        const page = await browser.newPage({ viewport: { width: size, height: size } });
        await page.setContent(
            `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
        );
        await page.screenshot({ path: output, omitBackground: transparent });
        await page.close();
        console.log(`${output} (${size}×${size})`);
    }
} finally {
    await browser.close();
}

await copyFile('icons/icon.svg', 'public/favicon.svg');
console.log('public/favicon.svg');
