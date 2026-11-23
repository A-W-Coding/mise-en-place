/**
 * @module web/src/cooking/CookingMode
 * The cooking mode panel on the recipe page: a switch that keeps the screen
 * on, and the button that adds a timer (technical spec §3.4).
 *
 * At heart cooking mode is only that switch: the page itself doesn't change,
 * so the whole recipe stays readable and scrollable. Where the screen can't
 * be kept on, the panel says so rather than failing silently.
 */

import { useId } from 'react';
import { openTimerDialog } from '../timers/timerStore';
import { TimerIcon } from '../components/Icons';
import { useWakeLock, type WakeLockStatus } from './useWakeLock';
import styles from './CookingMode.module.css';

const STATUS_TEXT: Record<WakeLockStatus, string> = {
    off: 'Keeps the screen on',
    on: 'On: the screen stays on',
    unsupported: "This browser can't keep the screen on, so it may sleep.",
    refused: "The browser wouldn't keep the screen on, so it may sleep.",
};

interface CookingModeProps {
    on: boolean;
    onChange: (on: boolean) => void;
}

export function CookingMode({ on, onChange }: CookingModeProps) {
    const status = useWakeLock(on);
    const labelId = useId();
    const statusId = useId();

    // A warning is longer than the usual note, so it gets a line of its own under the switch
    const warning = status === 'unsupported' || status === 'refused';

    return (
        <section aria-label="Cooking mode" className={`${styles.panel} ${on ? styles.panelOn : ''}`}>
            <div className={styles.row}>
                <span className={styles.text}>
                    <span id={labelId} className={styles.title}>
                        Cooking mode
                    </span>
                    {!warning && (
                        <span id={statusId} className={styles.status}>
                            {STATUS_TEXT[status]}
                        </span>
                    )}
                </span>
                <button type="button" className={styles.timerButton} onClick={openTimerDialog}>
                    <TimerIcon size={18} />
                    Timer
                </button>
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-labelledby={labelId}
                    aria-describedby={statusId}
                    className={styles.switch}
                    onClick={() => onChange(!on)}
                >
                    <span className={styles.knob} />
                </button>
            </div>
            {warning && (
                <p id={statusId} className={styles.warning}>
                    {STATUS_TEXT[status]}
                </p>
            )}
        </section>
    );
}
