/**
 * @module web/src/pages/OptionsPage
 * `/options`: how the app looks on this device, the timer sound, whether it
 * can reach the server, the offline copy (3c), and Advanced › Ingredients
 * (technical spec §3.4).
 */

import { useId } from 'react';
import { Link } from 'react-router';
import { useHealth } from '../api/queries';
import { BackLink } from '../components/BackLink';
import { ChevronRightIcon } from '../components/Icons';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useNow } from '../components/useNow';
import { formatAge } from '../format';
import { useOfflineCopy } from '../offline/copy';
import { useStorageProtection, type Protection } from '../offline/protection';
import { requestSync, useSyncStatus } from '../offline/sync';
import { useWaitingChanges } from '../offline/waiting';
import { usePreferences, type TextSize, type Theme } from '../preferences';
import { playChime, unlockAudio, vibrate } from '../timers/sound';
import styles from './OptionsPage.module.css';

const THEME_CHOICES: [Theme, string][] = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
];

const TEXT_SIZE_CHOICES: [TextSize, string][] = [
    ['smaller', 'Smaller'],
    ['normal', 'Normal'],
    ['larger', 'Larger'],
];

export function OptionsPage() {
    useDocumentTitle('Options');
    const [preferences, setPreference] = usePreferences();

    return (
        <div className={styles.page}>
            <BackLink to="/">Recipes</BackLink>
            <h1 className={styles.heading}>Options</h1>

            <section aria-labelledby="appearance-heading" className={styles.section}>
                <h2 id="appearance-heading" className={styles.sectionTitle}>
                    Appearance
                </h2>
                <div className={styles.card}>
                    <Choice
                        label="Theme"
                        choices={THEME_CHOICES}
                        value={preferences.theme}
                        onChange={(theme) => setPreference('theme', theme)}
                    />
                    <Choice
                        label="Text size"
                        choices={TEXT_SIZE_CHOICES}
                        value={preferences.textSize}
                        onChange={(size) => setPreference('textSize', size)}
                    />
                    <p className={styles.hint}>Saved on this device only.</p>
                </div>
            </section>

            <section aria-labelledby="cooking-heading" className={styles.section}>
                <h2 id="cooking-heading" className={styles.sectionTitle}>
                    Cooking
                </h2>
                <div className={styles.card}>
                    <div className={styles.switchRow}>
                        <span id="timer-sound-label" className={styles.switchLabel}>
                            Timer sound
                        </span>
                        <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => {
                                unlockAudio();
                                playChime();
                                vibrate();
                            }}
                        >
                            Test
                        </button>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={preferences.timerSound}
                            aria-labelledby="timer-sound-label"
                            className={styles.switch}
                            onClick={() => setPreference('timerSound', !preferences.timerSound)}
                        >
                            <span className={styles.knob} />
                        </button>
                    </div>
                    <p className={styles.hint}>
                        Timers ring while the app is on screen. If you switch to another app, they can't ring until you come
                        back.
                    </p>
                </div>
            </section>

            <section aria-labelledby="connection-heading" className={styles.section}>
                <h2 id="connection-heading" className={styles.sectionTitle}>
                    Connection
                </h2>
                <div className={styles.card}>
                    <Connection />
                </div>
            </section>

            <section aria-labelledby="offline-heading" className={styles.section}>
                <h2 id="offline-heading" className={styles.sectionTitle}>
                    Offline copy
                </h2>
                <div className={styles.card}>
                    <OfflineCopyStatus />
                </div>
            </section>

            <section aria-labelledby="advanced-heading" className={styles.section}>
                <h2 id="advanced-heading" className={styles.sectionTitle}>
                    Advanced
                </h2>
                <Link to="/options/ingredients" className={styles.linkCard}>
                    <span className={styles.linkText}>
                        <span className={styles.linkTitle}>Ingredients</span>
                        <span className={styles.hint}>The shared list every recipe uses</span>
                    </span>
                    <ChevronRightIcon />
                </Link>
            </section>
        </div>
    );
}

interface ChoiceProps<T extends string> {
    label: string;
    choices: [T, string][];
    value: T;
    onChange: (value: T) => void;
}

/** A row of buttons, one pressed: the theme or the text size. */
function Choice<T extends string>({ label, choices, value, onChange }: ChoiceProps<T>) {
    const labelId = useId();
    return (
        <div role="group" aria-labelledby={labelId} className={styles.choice}>
            <span id={labelId} className={styles.choiceLabel}>
                {label}
            </span>
            <div className={styles.segments}>
                {choices.map(([choice, text]) => (
                    <button
                        key={choice}
                        type="button"
                        aria-pressed={value === choice}
                        className={styles.segment}
                        onClick={() => onChange(choice)}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Whether the API, and its database, answer. Refresh, or coming back to the app, checks again. */
function Connection() {
    const health = useHealth();
    const checkedAt = health.dataUpdatedAt || health.errorUpdatedAt;
    const time = checkedAt ? new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

    let state: 'checking' | 'ok' | 'down';
    let title: string;
    let detail: string | null = null;
    if (health.isFetching && !health.isSuccess && !health.isError) {
        state = 'checking';
        title = 'Checking…';
    } else if (health.isError) {
        state = 'down';
        if (health.error.isNetworkError) {
            title = "Can't reach the server";
            detail = 'Check Tailscale is connected on this device.';
        } else {
            title = 'The server has a problem';
            detail =
                health.error.status === 503 ? "It's running, but its database isn't answering." : health.error.message;
        }
    } else {
        state = 'ok';
        title = 'Server reachable';
    }

    return (
        <div className={styles.connection}>
            <div className={styles.connectionRow} role="status">
                <span className={`${styles.dot} ${styles[state]}`} aria-hidden="true" />
                <span className={styles.connectionTitle}>{title}</span>
                {time && state !== 'checking' && <span className={styles.hint}>Checked at {time}</span>}
            </div>
            {detail && <p className={styles.hint}>{detail}</p>}
            <button
                type="button"
                className={styles.smallButton}
                onClick={() => void health.refetch()}
                disabled={health.isFetching}
            >
                Check again
            </button>
        </div>
    );
}

const PROTECTION_TEXT: Record<Exclude<Protection, 'checking'>, string> = {
    protected: "Protected: the browser won't clear it to free up space.",
    unprotected: 'Not protected: the browser may clear it if this device runs low on space.',
    refused: "Not protected: the browser didn't allow it.",
    unsupported: "This browser can't protect it, so it may be cleared if this device runs low on space.",
};

/**
 * The offline copy: how many recipes it holds, when it was last refreshed,
 * whether the browser will keep it, and Protect and Refresh now (technical
 * spec §3.4, "Visible state"), with the changes waiting to upload (3c).
 */
function OfflineCopyStatus() {
    const { status, copy } = useOfflineCopy();
    const { changes } = useWaitingChanges();
    const stuck = changes.filter((change) => change.problem !== null).length;
    const sync = useSyncStatus();
    const { protection, protect } = useStorageProtection();
    const now = useNow();

    let title: string;
    let detail: string;
    if (status === 'loading') {
        title = 'Checking…';
        detail = '';
    } else if (copy) {
        const count = copy.data.recipes.length;
        title = `${count === 1 ? '1 recipe' : `${count} recipes`} on this device`;
        detail = `Refreshed ${formatAge(copy.checkedAt, now)}. They open with no connection, and cooking mode works.`;
    } else {
        title = 'Not saved yet';
        detail = 'Every recipe is saved on this device the next time the app reaches the server.';
    }

    return (
        <div className={styles.connection}>
            <span className={styles.connectionTitle}>{title}</span>
            {detail && <p className={styles.hint}>{detail}</p>}
            {changes.length > 0 && (
                <p className={styles.waitingLine}>
                    {changes.length === 1 ? '1 change' : `${changes.length} changes`} waiting to upload
                    {stuck > 0 && `, ${stuck} of them needing your attention`}.
                </p>
            )}
            {sync.lastError && (
                <p className={styles.hint}>
                    The last refresh failed: {sync.lastError} It tries again by itself while the app is open.
                </p>
            )}
            {protection !== 'checking' && (
                <p className={styles.hint}>
                    {PROTECTION_TEXT[protection]}
                    {/* They're the only copy until they upload */}
                    {changes.length > 0 && protection !== 'protected' && ' Changes waiting to upload would go with it.'}
                </p>
            )}
            <div className={styles.buttons}>
                {(protection === 'unprotected' || protection === 'refused') && (
                    <button type="button" className={styles.smallButton} onClick={protect}>
                        Protect
                    </button>
                )}
                <button type="button" className={styles.smallButton} onClick={requestSync} disabled={sync.refreshing}>
                    Refresh now
                </button>
            </div>
        </div>
    );
}
