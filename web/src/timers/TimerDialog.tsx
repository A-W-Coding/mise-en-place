/**
 * @module web/src/timers/TimerDialog
 * The "New timer" sheet: an optional label, and a length picked from a few
 * common ones or set to the minute (technical spec §3.4).
 *
 * Starting a timer is also the tap that lets the page play its chime later.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CloseIcon } from '../components/Icons';
import { unlockAudio } from './sound';
import { closeTimerDialog, startTimer, useTimerState } from './timerStore';
import styles from './Timers.module.css';

const PRESETS = [5, 10, 15, 20, 30, 45];
const DEFAULT_MINUTES = '15';
/** Ten hours: anything longer is the oven's job, or a typo. */
const MAX_MINUTES = 600;

export function TimerDialog() {
    const { dialogOpen } = useTimerState();
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const lengthId = useId();
    const [label, setLabel] = useState('');
    const [minutes, setMinutes] = useState(DEFAULT_MINUTES);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (dialogOpen && !element.open) element.showModal();
        if (!dialogOpen && element.open) element.close();
    }, [dialogOpen]);

    const close = () => {
        closeTimerDialog();
        setLabel('');
        setMinutes(DEFAULT_MINUTES);
    };

    const value = Number(minutes.trim());
    const valid = /^\d+$/.test(minutes.trim()) && value >= 1 && value <= MAX_MINUTES;
    const step = (by: number) => setMinutes(String(Math.min(MAX_MINUTES, Math.max(1, (valid ? value : 0) + by))));

    const start = (event: FormEvent) => {
        event.preventDefault();
        if (!valid) return;
        unlockAudio();
        startTimer(value, label);
        close();
    };

    return (
        <dialog
            ref={dialog}
            aria-labelledby={titleId}
            className={styles.sheet}
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
        >
            {dialogOpen && (
                <form onSubmit={start} className={styles.sheetForm} noValidate>
                    <div className={styles.sheetHeader}>
                        <h2 id={titleId} className={styles.sheetTitle}>
                            New timer
                        </h2>
                        <button type="button" className={styles.iconButton} aria-label="Close" onClick={close}>
                            <CloseIcon />
                        </button>
                    </div>

                    <label className={styles.field}>
                        Label (optional)
                        <input
                            className={styles.input}
                            placeholder="e.g. Stir"
                            value={label}
                            maxLength={40}
                            onChange={(event) => setLabel(event.target.value)}
                        />
                    </label>

                    <div role="group" aria-labelledby={lengthId} className={styles.field}>
                        <span id={lengthId}>Length</span>
                        <div className={styles.presets}>
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    aria-pressed={valid && value === preset}
                                    className={styles.preset}
                                    onClick={() => setMinutes(String(preset))}
                                >
                                    {preset} min
                                </button>
                            ))}
                        </div>
                        <div className={styles.stepper}>
                            <span className={styles.stepperLabel}>Or exact minutes</span>
                            <button type="button" className={styles.stepButton} aria-label="One minute less" onClick={() => step(-1)}>
                                −
                            </button>
                            <input
                                className={styles.minutes}
                                aria-label="Minutes"
                                inputMode="numeric"
                                value={minutes}
                                aria-invalid={valid ? undefined : true}
                                onChange={(event) => setMinutes(event.target.value)}
                            />
                            <button type="button" className={styles.stepButton} aria-label="One minute more" onClick={() => step(1)}>
                                +
                            </button>
                        </div>
                        {!valid && <p className={styles.invalid}>Choose 1 to {MAX_MINUTES} minutes.</p>}
                    </div>

                    <button type="submit" className={styles.start} disabled={!valid}>
                        {valid ? `Start ${value}-minute timer` : 'Start timer'}
                    </button>
                    <p className={styles.note}>Timers ring while the app is on screen.</p>
                </form>
            )}
        </dialog>
    );
}
