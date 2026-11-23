/**
 * @module web/src/timers/TimerBar
 * The running timers, as small chips along the bottom of the screen on every
 * page (technical spec §3.4). The page leaves room for them, so they never
 * cover the recipe.
 *
 * A timer that ends plays the chime (if Timer sound is on in Options),
 * vibrates where the device can, and grows into "Stir: time's up" with a
 * Dismiss button. It rings again every few seconds until dismissed, for up
 * to two minutes. Timers ring only while the app is on screen (D14): one that
 * ended while another app was open rings when you come back.
 */

import { useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon, TimerIcon } from '../components/Icons';
import { getPreferences } from '../preferences';
import { playChime, vibrate } from './sound';
import { describeRemaining, formatRemaining, openTimerDialog, removeTimer, useTimerState } from './timerStore';
import styles from './Timers.module.css';

/** How often the chips update. A quarter second keeps the seconds steady. */
const TICK_MS = 250;
/** A finished timer rings again this often until dismissed… */
export const RING_EVERY_MS = 5_000;
/** …for this long. */
export const RING_FOR_MS = 120_000;

function ring() {
    if (getPreferences().timerSound) playChime();
    vibrate();
}

export function TimerBar() {
    const { timers } = useTimerState();
    const [now, setNow] = useState(() => Date.now());
    // When each finished timer last rang
    const lastRung = useRef(new Map<string, number>());

    useEffect(() => {
        if (timers.length === 0) return;
        const interval = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(interval);
    }, [timers.length]);

    useEffect(() => {
        const rung = lastRung.current;
        for (const id of rung.keys()) {
            if (!timers.some((timer) => timer.id === id)) rung.delete(id);
        }
        for (const timer of timers) {
            if (timer.endsAt > now) continue;
            const last = rung.get(timer.id);
            const stillRinging = now - timer.endsAt <= RING_FOR_MS && last !== undefined && now - last >= RING_EVERY_MS;
            if (last === undefined || stillRinging) {
                ring();
                rung.set(timer.id, now);
            }
        }
    }, [now, timers]);

    if (timers.length === 0) return null;

    return (
        <div className={styles.bar} role="region" aria-label="Timers">
            {timers.map((timer) => {
                // Never more than its length, even before the first tick after it starts
                const remaining = Math.min(timer.durationMs, timer.endsAt - now);
                if (remaining <= 0) {
                    return (
                        <div key={timer.id} role="alert" className={styles.done}>
                            <TimerIcon size={20} />
                            <span className={styles.doneText}>{timer.label}: time's up</span>
                            <button type="button" className={styles.dismiss} onClick={() => removeTimer(timer.id)}>
                                Dismiss
                            </button>
                        </div>
                    );
                }
                return (
                    <div key={timer.id} className={styles.chip}>
                        <TimerIcon size={16} />
                        <span aria-hidden="true" className={styles.chipText}>
                            {timer.label} {formatRemaining(remaining)}
                        </span>
                        <span className="visually-hidden">
                            {timer.label} timer, {describeRemaining(remaining)} left
                        </span>
                        <button
                            type="button"
                            className={styles.cancel}
                            aria-label={`Cancel ${timer.label} timer`}
                            onClick={() => removeTimer(timer.id)}
                        >
                            <CloseIcon size={14} />
                        </button>
                    </div>
                );
            })}
            <button type="button" className={styles.add} aria-label="Add a timer" onClick={openTimerDialog}>
                <PlusIcon size={18} />
            </button>
        </div>
    );
}
