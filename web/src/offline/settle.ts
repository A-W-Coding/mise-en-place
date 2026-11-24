/**
 * @module web/src/offline/settle
 * Settling a change that couldn't upload (Step 18; technical spec §3.4,
 * "When an upload can't go through").
 *
 * Each choice rewrites the waiting change and asks for a sync, so it uploads
 * at once if the Pi can be reached, and by itself later if not:
 * - **Keep mine:** the same edit, now with the ETag of their version, so
 *   it's saved over that one. If theirs changes again first, it's another
 *   412, and the choice comes back.
 * - **Keep both,** or **save as new** for a recipe deleted elsewhere: mine
 *   becomes a new recipe with an id of its own, keeping its place in the
 *   queue. Keep both adds "(copy)" to its name.
 * - **Keep theirs,** or **discard:** mine is dropped. The page asks first.
 */

import { LIMITS } from '../../../shared/limits';
import { requestSync } from './sync';
import { discardWaitingChange, replaceWaitingChange, type WaitingChange } from './waiting';

const COPY = ' (copy)';

/** A name with "(copy)" after it, shortened to fit if it must be. */
export function copyName(name: string): string {
    return `${name.slice(0, LIMITS.recipeName - COPY.length).trimEnd()}${COPY}`;
}

/** Save mine over theirs: `theirsEtag` is the ETag of the version it replaces. */
export async function keepMine(change: WaitingChange, theirsEtag: string): Promise<void> {
    await replaceWaitingChange(change, { ...change, kind: 'edit', etag: theirsEtag, sent: [], problem: null });
    requestSync();
}

/**
 * Save mine as a new recipe, leaving theirs (or nothing, if it was deleted)
 * where it was.
 *
 * @returns The new recipe's id.
 */
export async function keepAsNew(change: WaitingChange, { copy }: { copy: boolean }): Promise<string> {
    const recipeId = crypto.randomUUID();
    const name = copy ? copyName(change.body.name) : change.body.name;
    await replaceWaitingChange(change, {
        ...change,
        recipeId,
        kind: 'create',
        body: { ...change.body, name },
        etag: null,
        sent: [],
        problem: null,
    });
    requestSync();
    return recipeId;
}

/** Drop mine: keep theirs, or let a recipe deleted elsewhere go. */
export function discardMine(change: WaitingChange): Promise<void> {
    return discardWaitingChange(change.recipeId);
}
