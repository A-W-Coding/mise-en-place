/**
 * @module web/src/timers/StepTimerButton
 * A step's timer on the recipe page (3b, technical spec §3.4): "Start 20 min
 * timer", one tap. While that timer runs, the button shows its time left;
 * its chip in the timer bar, named after the step ("Chilli, step 4"),
 * cancels it. Once it has rung, the step can start it again.
 *
 * The tap that starts it is also the one that lets the page play its chime.
 */

import { formatDuration } from '../../../shared/quantity';
import { TimerIcon } from '../components/Icons';
import { useNow } from '../components/useNow';
import { unlockAudio } from './sound';
import { describeRemaining, formatRemaining, startTimer, useTimerState } from './timerStore';
import styles from './Timers.module.css';

interface StepTimerButtonProps {
    stepId: string;
    seconds: number;
    /** The timer's name on its chip: "Step 4", or "Chilli, step 4". */
    label: string;
}

/** How often a running step's time left updates: as often as the chips do. */
const TICK_MS = 250;

export function StepTimerButton({ stepId, seconds, label }: StepTimerButtonProps) {
    const source = `step:${stepId}`;
    const running = useTimerState().timers.find((timer) => timer.source === source);
    // Ticking only matters while it runs
    const now = useNow(running ? TICK_MS : 60_000);
    const remaining = running ? Math.min(running.durationMs, running.endsAt - now) : 0;

    if (running && remaining > 0) {
        return (
            <span className={styles.stepRunning}>
                <TimerIcon size={18} />
                <span aria-hidden="true">{formatRemaining(remaining)} left</span>
                <span className="visually-hidden">
                    {label} timer running, {describeRemaining(remaining)} left
                </span>
            </span>
        );
    }

    return (
        <button
            type="button"
            className={styles.stepStart}
            onClick={() => {
                unlockAudio();
                startTimer(seconds / 60, label, Date.now(), source);
            }}
        >
            <TimerIcon size={18} />
            Start {formatDuration(seconds)} timer
        </button>
    );
}
