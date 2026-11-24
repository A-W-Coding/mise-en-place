/**
 * @module web/src/components/Waiting
 * How changes waiting on the device show (3c, D15): a notice on the recipe's
 * page, a tag in the list, and a banner on every page while one couldn't be
 * uploaded and needs your attention.
 *
 * On the recipe's page, a change that couldn't upload says why, with the
 * choices that settle it (Step 18, `offline/settle.ts`). Each choice that
 * loses a version asks first; nothing is discarded without a tap.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Recipe } from '../api/types';
import { formatAge } from '../format';
import type { ReadResult } from '../offline/read';
import { discardMine, keepAsNew, keepMine } from '../offline/settle';
import { useWaitingChanges, type WaitingChange } from '../offline/waiting';
import { ConfirmDialog } from './ConfirmDialog';
import { useNow } from './useNow';
import styles from './Waiting.module.css';

/** Above a recipe with a change waiting to upload: when it was saved. */
export function WaitingNotice({ change }: { change: WaitingChange }) {
    const now = useNow();
    return (
        <div role="status" className={styles.notice}>
            <strong>Waiting to upload.</strong> Saved on this device {formatAge(change.savedAt, now)}. It uploads by itself
            once the server can be reached.
        </div>
    );
}

type Asking = 'keepMine' | 'keepTheirs' | 'discard';

interface SettleChangeProps {
    /** A change with a problem. */
    change: WaitingChange;
    /** Their version, from the API or the offline copy, with the ETag Keep mine saves over. */
    theirs: ReadResult<Recipe> | undefined;
    showingTheirs: boolean;
    onShowTheirs: (theirs: boolean) => void;
}

/** Above a recipe whose change couldn't upload: why, and the choices that settle it. */
export function SettleChange({ change, theirs, showingTheirs, onShowTheirs }: SettleChangeProps) {
    const navigate = useNavigate();
    const [asking, setAsking] = useState<Asking | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { problem } = change;
    if (!problem) return null;

    /** Run a choice; it only touches this device, so the one way it fails is storage. */
    const choose = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            setAsking(null);
        } catch (failure) {
            console.warn("A choice couldn't be kept on the device.", failure);
            setError("This device couldn't keep that choice. Try again.");
        } finally {
            setBusy(false);
        }
    };

    const asNew = (copy: boolean) =>
        choose(async () => {
            const id = await keepAsNew(change, { copy });
            navigate(`/recipes/${id}`, { replace: true });
        });

    const theirsEtag = theirs?.etag ?? null;

    return (
        <>
            <section aria-label="Needs your attention" className={`${styles.notice} ${styles.attention}`}>
                {problem.kind === 'changed' && (
                    <>
                        <p className={styles.text}>
                            <strong>Needs your attention.</strong> This recipe was changed on another device after you started
                            editing it, so yours wasn't saved over theirs. Yours is kept on this device until you choose.
                        </p>
                        <div role="group" aria-label="Version shown" className={styles.segments}>
                            <button
                                type="button"
                                aria-pressed={!showingTheirs}
                                className={styles.segment}
                                onClick={() => onShowTheirs(false)}
                            >
                                Yours
                            </button>
                            <button
                                type="button"
                                aria-pressed={showingTheirs}
                                className={styles.segment}
                                disabled={!theirs}
                                onClick={() => onShowTheirs(true)}
                            >
                                Theirs
                            </button>
                        </div>
                        <div className={styles.choices}>
                            <button
                                type="button"
                                className={styles.choice}
                                disabled={busy || theirsEtag === null}
                                onClick={() => setAsking('keepMine')}
                            >
                                Keep mine
                            </button>
                            <button type="button" className={styles.choice} disabled={busy} onClick={() => setAsking('keepTheirs')}>
                                Keep theirs
                            </button>
                            <button type="button" className={styles.choice} disabled={busy} onClick={() => void asNew(true)}>
                                Keep both
                            </button>
                        </div>
                        {theirsEtag === null && (
                            <p className={styles.text}>Their version hasn't loaded yet, so Keep mine waits for it.</p>
                        )}
                    </>
                )}

                {problem.kind === 'deleted' && (
                    <>
                        <p className={styles.text}>
                            <strong>Needs your attention.</strong> This recipe was deleted on another device, so your changes
                            weren't uploaded. They're kept on this device until you choose.
                        </p>
                        <div className={styles.choices}>
                            <button type="button" className={styles.choice} disabled={busy} onClick={() => void asNew(false)}>
                                Save as a new recipe
                            </button>
                            <button type="button" className={styles.choice} disabled={busy} onClick={() => setAsking('discard')}>
                                Discard
                            </button>
                        </div>
                    </>
                )}

                {problem.kind === 'refused' && (
                    <>
                        <p className={styles.text}>
                            <strong>Needs your attention.</strong> The server didn't accept this version ({problem.message}).
                            Edit it to put that right; saving uploads it.
                        </p>
                        <div className={styles.choices}>
                            <Link to={`/recipes/${change.recipeId}/edit`} className={styles.choice}>
                                Edit it
                            </Link>
                        </div>
                    </>
                )}

                {error && !asking && (
                    <p role="alert" className={styles.text}>
                        {error}
                    </p>
                )}
            </section>

            <ConfirmDialog
                open={asking === 'keepMine'}
                title="Save yours over theirs?"
                confirmLabel="Keep mine"
                tone="danger"
                busy={busy}
                error={error}
                onConfirm={() => theirsEtag && void choose(() => keepMine(change, theirsEtag))}
                onCancel={() => setAsking(null)}
            >
                <p>The changes made on the other device will be lost.</p>
            </ConfirmDialog>
            <ConfirmDialog
                open={asking === 'keepTheirs'}
                title="Keep theirs, and discard yours?"
                confirmLabel="Discard mine"
                tone="danger"
                busy={busy}
                error={error}
                onConfirm={() => void choose(() => discardMine(change))}
                onCancel={() => setAsking(null)}
            >
                <p>Your changes on this device will be lost.</p>
            </ConfirmDialog>
            <ConfirmDialog
                open={asking === 'discard'}
                title="Discard your version?"
                confirmLabel="Discard"
                tone="danger"
                busy={busy}
                error={error}
                onConfirm={() =>
                    void choose(async () => {
                        await discardMine(change);
                        navigate('/', { replace: true });
                    })
                }
                onCancel={() => setAsking(null)}
            >
                <p>The recipe was deleted on another device, and your version on this device will go too.</p>
            </ConfirmDialog>
        </>
    );
}

/** The list's tag for a recipe with a change waiting. */
export function WaitingTag({ change }: { change: WaitingChange }) {
    return change.problem ? (
        <span className={`${styles.tag} ${styles.attentionTag}`}>Needs your attention</span>
    ) : (
        <span className={styles.tag}>Waiting to upload</span>
    );
}

/** On every page while any change couldn't be uploaded, linking to each. */
export function AttentionBanner() {
    const { changes } = useWaitingChanges();
    const stuck = changes.filter((change) => change.problem !== null);
    if (stuck.length === 0) return null;
    const one = stuck.length === 1;

    return (
        <div role="alert" className={styles.banner}>
            <p>
                <strong>{one ? "A change couldn't be uploaded." : `${stuck.length} changes couldn't be uploaded.`}</strong>{' '}
                {one ? "It's" : "They're"} kept on this device until you look:{' '}
                {stuck.map((change, index) => (
                    <span key={change.recipeId}>
                        {index > 0 && ', '}
                        <Link to={`/recipes/${change.recipeId}`}>{change.body.name}</Link>
                    </span>
                ))}
                .
            </p>
        </div>
    );
}
