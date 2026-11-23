/**
 * @module web/e2e/global-setup
 * Runs once before the end-to-end tests: applies the API's migrations to the
 * _test database. The config has already refused any other database (T1).
 */

import { execSync } from 'node:child_process';

export default function globalSetup(): void {
    execSync('npx prisma migrate deploy', { cwd: '..', env: process.env, stdio: 'inherit' });
}
