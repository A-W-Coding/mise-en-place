/**
 * @module web/e2e/global-setup
 * Runs once before the end-to-end tests: applies the API's migrations to the
 * _test database, and empties the folder the tests' photos go to (3b). The
 * config has already refused any other database (T1), and set MEDIA_DIR.
 */

import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export default function globalSetup(): void {
    execSync('npx prisma migrate deploy', { cwd: '..', env: process.env, stdio: 'inherit' });
    if (process.env.MEDIA_DIR) rmSync(process.env.MEDIA_DIR, { recursive: true, force: true });
}
