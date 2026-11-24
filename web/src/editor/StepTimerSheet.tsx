/**
 * @module web/src/editor/StepTimerSheet
 * The sheet that sets a step's timer in the editor (3b, as the wireframes
 * have it): the length typed ("15 min", "1 h 30 min", read by
 * `parseDuration()`) or picked from a few presets, and Remove timer for a
 * step that has one. The recipe page then starts it with one tap.
 *
 * The editor is a form, and the sheet has a form of its own, so the sheet is
 * drawn at the end of the page (a portal) rather than inside the editor's
 * form, and its submit stops there: Set timer mustn't save the recipe.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration, parseDuration } from '../../../shared/quantity';
import timers from '../timers/Timers.module.css';
import styles from './Editor.module.css';

/** The step whose timer is being set. */
export interface TimerTarget {
    key: string;
    /** How the step is named: "step 4", or "Chilli, step 4". */
    label: string;
    text: string;
    timerSeconds: number | null;
}

/** Quick lengths, in seconds: 5, 10, 15, 20 and 30 minutes, and an hour. */
const PRESETS = [300, 600, 900, 1200, 1800, 3600];

interface StepTimerSheetProps {
    target: TimerTarget | null;
    /** The new length in seconds, or null to remove the timer. */
    onSet: (seconds: number | null) => void;
    onClose: () => void;
}

export function StepTimerSheet({ target, onSet, onClose }: StepTimerSheetProps) {
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (target && !element.open) element.showModal();
        if (!target && element.open) element.close();
    }, [target]);

    return createPortal(
        <dialog
            ref={dialog}
            aria-label={target ? `Timer for ${target.label}` : 'Timer'}
            className={timers.sheet}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            {target && <TimerForm key={target.key} target={target} onSet={onSet} onClose={onClose} />}
        </dialog>,
        document.body,
    );
}

function TimerForm({ target, onSet, onClose }: StepTimerSheetProps & { target: TimerTarget }) {
    const titleId = useId();
    const inputId = useId();
    const [text, setText] = useState(target.timerSeconds === null ? '' : formatDuration(target.timerSeconds));
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const parsed = parseDuration(text);
    const chosen = 'seconds' in parsed ? parsed.seconds : null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        // React passes events up through a portal to the editor's form
        event.stopPropagation();
        if ('error' in parsed) {
            setError(parsed.error);
            input.current?.focus();
            return;
        }
        onSet(parsed.seconds);
    };

    return (
        <form onSubmit={submit} className={timers.sheetForm} noValidate aria-labelledby={titleId}>
            <div className={styles.timerHeading}>
                <h2 id={titleId} className={timers.sheetTitle}>
                    Timer for {target.label}
                </h2>
                {target.text.trim() !== '' && <p className={styles.timerStep}>{target.text.trim()}</p>}
            </div>

            <div className={timers.field}>
                <label htmlFor={inputId}>How long</label>
                <input
                    ref={input}
                    id={inputId}
                    className={timers.input}
                    autoFocus
                    autoComplete="off"
                    placeholder="15 min"
                    value={text}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
                    onChange={(event) => {
                        setText(event.target.value);
                        setError(null);
                    }}
                />
                <p id={`${inputId}-hint`} className={styles.hint}>
                    Like 90 s, 15 min or 1 h 30 min. Up to a day.
                </p>
                {error && (
                    <p id={`${inputId}-error`} className={styles.error}>
                        {error}
                    </p>
                )}
            </div>

            <div role="group" aria-label="Quick lengths" className={timers.presets}>
                {PRESETS.map((seconds) => (
                    <button
                        key={seconds}
                        type="button"
                        className={timers.preset}
                        aria-pressed={chosen === seconds}
                        onClick={() => {
                            setText(formatDuration(seconds));
                            setError(null);
                        }}
                    >
                        {formatDuration(seconds)}
                    </button>
                ))}
            </div>

            <div className={styles.timerActions}>
                {target.timerSeconds !== null && (
                    <button type="button" className={styles.removeTimer} onClick={() => onSet(null)}>
                        Remove timer
                    </button>
                )}
                <span className={styles.spacer} />
                <button type="button" className={styles.secondaryButton} onClick={onClose}>
                    Cancel
                </button>
                <button type="submit" className={styles.primaryButton}>
                    Set timer
                </button>
            </div>
        </form>
    );
}
