/**
 * @module web/src/components/Waiting
 * How changes waiting on the device show (3c, D15): a notice on the recipe's
 * page, a tag in the list, and a banner on every page while one couldn't be
 * uploaded and needs your attention. Step 18 adds the choices for settling
 * one.
 */

import { Link } from 'react-router';
import { formatAge } from '../format';
import { useWaitingChanges, type ChangeProblem, type WaitingChange } from '../offline/waiting';
import { useNow } from './useNow';
import styles from './Waiting.module.css';

/** Why a change wasn't uploaded, in a sentence or two. */
function problemText(problem: ChangeProblem): string {
    switch (problem.kind) {
        case 'changed':
            return "It was changed on another device after you started editing it, so this version wasn't saved over that one. It's kept on this device.";
        case 'deleted':
            return "It was deleted on another device, so this version wasn't uploaded. It's kept on this device.";
        case 'refused': {
            const details = Object.entries(problem.fields).map(([field, message]) => `${field}: ${message}`);
            return `The server didn't accept it (${[problem.message, ...details].join(' ')}). Edit it to put that right, then save.`;
        }
    }
}

/** Above a recipe that has a change waiting: when it was saved, or why it couldn't be uploaded. */
export function WaitingNotice({ change }: { change: WaitingChange }) {
    const now = useNow();
    return (
        <div role="status" className={`${styles.notice} ${change.problem ? styles.attention : ''}`}>
            {change.problem ? (
                <>
                    <strong>Needs your attention.</strong> {problemText(change.problem)}
                </>
            ) : (
                <>
                    <strong>Waiting to upload.</strong> Saved on this device {formatAge(change.savedAt, now)}. It uploads by
                    itself once the server can be reached.
                </>
            )}
        </div>
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
