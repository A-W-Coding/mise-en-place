/**
 * @module web/src/timers/timerStore
 * The running timers, shared by every page (technical spec §3.4).
 *
 * Each timer is stored by the moment it ends, not by counting ticks, so it
 * stays right while the screen is locked or the browser pauses the page. The
 * list is kept in the browser's storage too, so a timer survives a reload,
 * or Android closing the tab: one that ended meanwhile rings on return.
 *
 * A tiny store rather than React state, so the recipe page's Timer button and
 * the chips in the layout share it without threading props through.
 */

import { useSyncExternalStore } from 'react';

export interface Timer {
    id: string;
    /** Shown on its chip; "Timer" when none was given. */
    label: string;
    durationMs: number;
    /** When it rings, in milliseconds since 1970 (`Date.now()`). */
    endsAt: number;
    /** What started it, such as a recipe's step (`step:<id>`), so the step can show it running (3b). */
    source?: string;
}

interface TimerState {
    timers: Timer[];
    /** Whether the "New timer" sheet is open. */
    dialogOpen: boolean;
}

const STORAGE_KEY = 'miseenplace.timers';

function isTimer(value: unknown): value is Timer {
    const timer = value as Timer;
    return (
        typeof timer === 'object' &&
        timer !== null &&
        typeof timer.id === 'string' &&
        typeof timer.label === 'string' &&
        typeof timer.durationMs === 'number' &&
        typeof timer.endsAt === 'number' &&
        (timer.source === undefined || typeof timer.source === 'string')
    );
}

function loadTimers(): Timer[] {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return Array.isArray(saved) ? saved.filter(isTimer) : [];
    } catch {
        return [];
    }
}

function saveTimers(timers: Timer[]): void {
    try {
        if (timers.length === 0) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
    } catch {
        // Not saved: the timers still run for this visit
    }
}

let state: TimerState | null = null;
const listeners = new Set<() => void>();

function getState(): TimerState {
    state ??= { timers: loadTimers(), dialogOpen: false };
    return state;
}

function update(change: Partial<TimerState>): void {
    const previous = getState();
    state = { ...previous, ...change };
    if (change.timers) saveTimers(change.timers);
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

let nextId = 0;

/** Start a timer. Returns its id. `source` says what started it, such as a step (3b). */
export function startTimer(minutes: number, label: string, now = Date.now(), source?: string): string {
    nextId += 1;
    const durationMs = Math.round(minutes * 60_000);
    const timer: Timer = {
        id: `${now}-${nextId}`,
        label: label.trim() || 'Timer',
        durationMs,
        endsAt: now + durationMs,
        ...(source === undefined ? {} : { source }),
    };
    update({ timers: [...getState().timers, timer] });
    return timer.id;
}

/** Cancel a running timer, or dismiss a finished one. */
export function removeTimer(id: string): void {
    update({ timers: getState().timers.filter((timer) => timer.id !== id) });
}

export function openTimerDialog(): void {
    update({ dialogOpen: true });
}

export function closeTimerDialog(): void {
    update({ dialogOpen: false });
}

/** The timers and whether the sheet is open, for a component. */
export function useTimerState(): TimerState {
    return useSyncExternalStore(subscribe, getState);
}

/** Forget everything, storage included. For tests. */
export function resetTimers(): void {
    state = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to clear
    }
}

/**
 * Time left as a chip shows it: "4:10", "18:42", "1:05:00". Rounded up, so a
 * timer shows 0:01 until it has really ended, and 5:00 the moment it starts.
 */
export function formatRemaining(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** The same, for a screen reader: "18 minutes 42 seconds". */
export function describeRemaining(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const part = (n: number, unit: string) => (n === 0 ? null : `${n} ${unit}${n === 1 ? '' : 's'}`);
    return [part(hours, 'hour'), part(minutes, 'minute'), part(seconds, 'second')].filter(Boolean).join(' ') || '0 seconds';
}
