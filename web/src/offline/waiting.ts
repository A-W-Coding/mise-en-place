/**
 * @module web/src/offline/waiting
 * Changes waiting to upload: recipes created or edited while the Pi couldn't
 * be reached (D15, technical spec §3.4, "Editing offline").
 *
 * - There's at most one per recipe. Saving a recipe that already has one
 *   replaces it, keeping its place in the queue. The editor opens a waiting
 *   change with its own kind and ETag, so an edit keeps the ETag it started
 *   from (a new recipe stays new) unless the editor reloaded the recipe.
 * - They're kept in IndexedDB, beside the offline copy, and survive a reload
 *   and the app being closed. The list in memory changes only once it's
 *   stored, so nothing is shown as saved that isn't.
 * - `sent` holds each version whose upload got no answer. Any of them may
 *   have reached the API, which is how a retry tells its own earlier upload
 *   from a change made elsewhere (see `upload.ts`).
 * - A change the API refused (412, 404 or 400) is kept with its `problem`,
 *   and waits for you rather than being retried. Step 18 adds the choices.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { FieldErrors } from '../api/client';
import type { DraftBody } from '../editor/draft';
import { offlineStorage } from './storage';

export type ChangeProblem =
    /** 412: the recipe changed elsewhere after this edit started. */
    | { kind: 'changed' }
    /** 404: the recipe was deleted elsewhere. */
    | { kind: 'deleted' }
    /** 400: the API refused it, with its messages. */
    | { kind: 'refused'; message: string; fields: FieldErrors };

export interface WaitingChange {
    recipeId: string;
    /** A new recipe, created with its id when it uploads, or an edit to an existing one. */
    kind: 'create' | 'edit';
    body: DraftBody;
    /** For an edit, the ETag of the version it started from, sent as `If-Match`. */
    etag: string | null;
    /** When it was first kept on the device: changes upload oldest first. */
    createdAt: number;
    /** When it was last saved. */
    savedAt: number;
    /** Versions sent with no answer back. Any of them may have arrived. */
    sent: DraftBody[];
    problem: ChangeProblem | null;
}

/** What the editor saves: the rest is the store's to keep. */
export type ChangeToKeep = Pick<WaitingChange, 'recipeId' | 'kind' | 'body' | 'etag'>;

export type WaitingState = { status: 'loading'; changes: [] } | { status: 'ready'; changes: WaitingChange[] };

const KEY = 'waitingChanges';

let state: WaitingState = { status: 'loading', changes: [] };
let loading: Promise<void> | null = null;
let generation = 0;
// Writes go one at a time, in order, so a slow one can't land after a later one
let writing: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function update(next: WaitingState): void {
    state = next;
    for (const listener of listeners) listener();
}

function isChange(value: unknown): value is WaitingChange {
    if (typeof value !== 'object' || value === null) return false;
    const change = value as Partial<WaitingChange>;
    return typeof change.recipeId === 'string' && typeof change.body === 'object' && Array.isArray(change.sent);
}

async function readFromStorage(started: number): Promise<void> {
    let changes: WaitingChange[] = [];
    try {
        const [stored] = await offlineStorage().getMany([KEY]);
        if (Array.isArray(stored)) changes = stored.filter(isChange);
    } catch (error) {
        console.warn("The changes waiting to upload couldn't be read.", error);
    }
    if (generation === started && state.status === 'loading') update({ status: 'ready', changes });
}

/** The waiting changes, oldest first, read from storage the first time they're asked for. */
export async function loadWaitingChanges(): Promise<WaitingChange[]> {
    loading ??= readFromStorage(generation);
    await loading;
    return state.changes;
}

/**
 * Store a new list made from the current one, then show it. Rejects, and
 * changes nothing, if it can't be stored.
 */
function write(change: (changes: WaitingChange[]) => WaitingChange[] | null): Promise<void> {
    const next = writing.then(async () => {
        const changes = change(await loadWaitingChanges());
        if (changes === null) return;
        await offlineStorage().setMany([[KEY, changes]]);
        update({ status: 'ready', changes });
    });
    writing = next.catch(() => {});
    return next;
}

function sameBody(a: DraftBody, b: DraftBody): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Keep a change on the device: a new one at the end of the queue, or the
 * latest version of one already waiting.
 *
 * @param sent - True when this version was just sent with no answer back, so it may have arrived.
 */
export function keepWaitingChange(keep: ChangeToKeep, { sent = false, now = Date.now() } = {}): Promise<void> {
    return write((changes) => {
        const existing = changes.find((change) => change.recipeId === keep.recipeId);
        const earlierSent = existing?.sent ?? [];
        const kept: WaitingChange = existing
            ? { ...existing, ...keep, savedAt: now, problem: null }
            : { ...keep, createdAt: now, savedAt: now, sent: [], problem: null };
        kept.sent = sent && !earlierSent.some((body) => sameBody(body, keep.body)) ? [...earlierSent, keep.body] : earlierSent;
        return existing
            ? changes.map((change) => (change.recipeId === keep.recipeId ? kept : change))
            : [...changes, kept];
    });
}

/** Note that this version was sent with no answer back. Ignored if the change has been saved again since. */
export function noteSent(change: WaitingChange): Promise<void> {
    return write((changes) => {
        const current = changes.find((candidate) => candidate.recipeId === change.recipeId);
        if (!current || current.savedAt !== change.savedAt || current.sent.some((body) => sameBody(body, change.body))) {
            return null;
        }
        return changes.map((candidate) =>
            candidate === current ? { ...current, sent: [...current.sent, change.body] } : candidate,
        );
    });
}

/**
 * A change has uploaded. If it wasn't saved again meanwhile, it's done. If
 * it was, the newer version is still waiting, now as an edit of the version
 * that just uploaded, with its ETag.
 */
export function settleUploaded(change: WaitingChange, etag: string | null): Promise<void> {
    return write((changes) => {
        const current = changes.find((candidate) => candidate.recipeId === change.recipeId);
        if (!current) return null;
        if (current.savedAt === change.savedAt) return changes.filter((candidate) => candidate !== current);
        return changes.map((candidate) =>
            candidate === current ? { ...current, kind: 'edit' as const, etag, sent: [] } : candidate,
        );
    });
}

/** The API refused a change: keep it, marked, unless it's been saved again since. */
export function markProblem(change: WaitingChange, problem: ChangeProblem): Promise<void> {
    return write((changes) => {
        const current = changes.find((candidate) => candidate.recipeId === change.recipeId);
        if (!current || current.savedAt !== change.savedAt) return null;
        return changes.map((candidate) => (candidate === current ? { ...current, problem } : candidate));
    });
}

/** Drop a recipe's waiting change: it was saved online, or the recipe was deleted. */
export function discardWaitingChange(recipeId: string): Promise<void> {
    return write((changes) =>
        changes.some((change) => change.recipeId === recipeId)
            ? changes.filter((change) => change.recipeId !== recipeId)
            : null,
    );
}

export function getWaitingState(): WaitingState {
    return state;
}

/** The waiting change for a recipe, if it has one. */
export function waitingChangeFor(recipeId: string): WaitingChange | undefined {
    return state.changes.find((change) => change.recipeId === recipeId);
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The waiting changes, read from storage if they haven't been yet, re-rendering as they change. */
export function useWaitingChanges(): WaitingState {
    useEffect(() => {
        void loadWaitingChanges();
    }, []);
    return useSyncExternalStore(subscribe, getWaitingState);
}

/** Forget the changes in memory, so the next read comes from storage. For tests. */
export function resetWaitingChanges(): void {
    generation += 1;
    loading = null;
    writing = Promise.resolve();
    update({ status: 'loading', changes: [] });
}
