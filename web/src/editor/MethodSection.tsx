/**
 * @module web/src/editor/MethodSection
 * One section of the method in the editor (3b, as the wireframes have it):
 * a card with the section's name and a ⋮ menu (move it, remove it), then
 * its steps, each in its own box with a Timer button and a ⋮ menu, then
 * "Add step".
 *
 * Enter in a step starts the next one, taking what's after the cursor with
 * it, so a method can be typed straight through on a phone. Pasting several
 * lines makes a step of each, as the migration did with Phase 1's text.
 */

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { formatDuration } from '../../../shared/quantity';
import { PlusIcon, TimerIcon } from '../components/Icons';
import { Menu } from '../components/Menu';
import {
    sectionErrorKey,
    sectionTitle,
    stepErrorKey,
    type DraftAction,
    type DraftErrors,
    type SectionDraft,
    type StepDraft,
} from './draft';
import type { TimerTarget } from './StepTimerSheet';
import styles from './Editor.module.css';

interface MethodSectionProps {
    section: SectionDraft;
    index: number;
    count: number;
    /** Whether steps are named with their section ("Chilli, step 2"), or just "Step 2". */
    named: boolean;
    errors: DraftErrors;
    dispatch: (action: DraftAction) => void;
    onTimer: (target: TimerTarget) => void;
    /** Remove the section, asking first when that loses anything. */
    onRemove: (section: SectionDraft) => void;
}

export function MethodSection({ section, index, count, named, errors, dispatch, onTimer, onRemove }: MethodSectionProps) {
    const addStep = useRef<HTMLButtonElement>(null);
    const title = sectionTitle(section, index);
    const nameId = `section-${section.key}-name`;
    const nameError = errors[sectionErrorKey(section.key, 'name')];
    const stepsError = errors[sectionErrorKey(section.key, 'steps')];
    const stepLabel = (n: number) => (named ? `${title}, step ${n}` : `Step ${n}`);

    return (
        <li className={`${styles.methodSection} ${nameError || stepsError ? styles.lineInvalid : ''}`}>
            <div className={styles.sectionHead}>
                <input
                    id={nameId}
                    className={`${styles.input} ${styles.sectionName}`}
                    aria-label={`Section ${index + 1}`}
                    placeholder="Section name, like Sauce"
                    autoComplete="off"
                    autoFocus={section.focus}
                    value={section.name}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? `${nameId}-error` : undefined}
                    onChange={(event) => dispatch({ type: 'sectionName', key: section.key, name: event.target.value })}
                />
                <Menu
                    label={`Options for section ${title}`}
                    buttonClassName={styles.lineMenu}
                    items={[
                        {
                            label: 'Move section up',
                            disabled: index === 0,
                            onSelect: () => dispatch({ type: 'moveSection', key: section.key, by: -1 }),
                        },
                        {
                            label: 'Move section down',
                            disabled: index === count - 1,
                            onSelect: () => dispatch({ type: 'moveSection', key: section.key, by: 1 }),
                        },
                        { label: 'Remove section…', danger: true, onSelect: () => onRemove(section) },
                    ]}
                />
            </div>
            {nameError && (
                <p id={`${nameId}-error`} className={styles.error}>
                    {nameError}
                </p>
            )}

            <ol className={styles.steps} aria-label={named ? `Steps of ${title}` : 'Steps'}>
                {section.steps.map((step, stepIndex) => (
                    <StepRow
                        key={step.key}
                        step={step}
                        n={stepIndex + 1}
                        count={section.steps.length}
                        label={stepLabel(stepIndex + 1)}
                        error={errors[stepErrorKey(step.key, 'text')] ?? errors[stepErrorKey(step.key, 'timer')]}
                        dispatch={dispatch}
                        onTimer={onTimer}
                        onRemoved={() => addStep.current?.focus()}
                    />
                ))}
            </ol>
            {stepsError && <p className={styles.error}>{stepsError}</p>}

            <button ref={addStep} type="button" className={styles.addStep} onClick={() => dispatch({ type: 'addStep', sectionKey: section.key })}>
                <PlusIcon size={18} />
                {named ? `Add step to ${title}` : 'Add step'}
            </button>
        </li>
    );
}

interface StepRowProps {
    step: StepDraft;
    n: number;
    count: number;
    label: string;
    error?: string;
    dispatch: (action: DraftAction) => void;
    onTimer: (target: TimerTarget) => void;
    onRemoved: () => void;
}

function StepRow({ step, n, count, label, error, dispatch, onTimer, onRemoved }: StepRowProps) {
    const errorId = `step-${step.key}-error`;
    // "Step 2" reads as a name; mid-sentence it's "step 2"
    const lowerLabel = label.replace(/^Step /, 'step ');

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        const { value, selectionStart, selectionEnd } = event.currentTarget;
        dispatch({ type: 'splitStep', key: step.key, before: value.slice(0, selectionStart), after: value.slice(selectionEnd) });
    };

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const pasted = event.clipboardData.getData('text');
        if (!/\r?\n/.test(pasted)) return;
        event.preventDefault();
        const { value, selectionStart, selectionEnd } = event.currentTarget;
        dispatch({ type: 'pasteSteps', key: step.key, text: value.slice(0, selectionStart) + pasted + value.slice(selectionEnd) });
    };

    return (
        <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">
                {n}
            </span>
            <div className={styles.stepBody}>
                <textarea
                    className={`${styles.input} ${styles.stepText}`}
                    aria-label={label}
                    rows={2}
                    autoFocus={step.focus}
                    value={step.text}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={(event) => dispatch({ type: 'step', key: step.key, patch: { text: event.target.value } })}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                />
                {error && (
                    <p id={errorId} className={styles.error}>
                        {error}
                    </p>
                )}
                <div className={styles.stepTools}>
                    <button
                        type="button"
                        className={step.timerSeconds === null ? styles.timerAdd : styles.timerSet}
                        aria-label={
                            step.timerSeconds === null
                                ? `Add a timer to ${lowerLabel}`
                                : `Timer for ${lowerLabel}: ${formatDuration(step.timerSeconds)}. Change it`
                        }
                        onClick={() => onTimer({ key: step.key, label: lowerLabel, text: step.text, timerSeconds: step.timerSeconds })}
                    >
                        <TimerIcon size={16} />
                        {step.timerSeconds === null ? 'Timer' : formatDuration(step.timerSeconds)}
                    </button>
                    <span className={styles.spacer} />
                    <Menu
                        label={`Options for ${lowerLabel}`}
                        buttonClassName={styles.lineMenu}
                        items={[
                            { label: 'Move up', disabled: n === 1, onSelect: () => dispatch({ type: 'moveStep', key: step.key, by: -1 }) },
                            { label: 'Move down', disabled: n === count, onSelect: () => dispatch({ type: 'moveStep', key: step.key, by: 1 }) },
                            {
                                label: 'Remove step',
                                danger: true,
                                onSelect: () => {
                                    dispatch({ type: 'removeStep', key: step.key });
                                    onRemoved();
                                },
                            },
                        ]}
                    />
                </div>
            </div>
        </li>
    );
}
