import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { setPreference } from '../preferences';
import { BEEF_CHILI_ID, beefChili, section } from '../test/fixtures';
import { json, mockApi, renderApp } from '../test/renderApp';
import { playChime, unlockAudio, vibrate } from './sound';
import { RING_EVERY_MS, RING_FOR_MS } from './TimerBar';
import { describeRemaining, formatRemaining, removeTimer, startTimer } from './timerStore';

vi.mock('./sound');

const START = new Date('2026-11-23T12:00:00Z');
const MINUTE = 60_000;

beforeEach(() => {
    // Only the clock and the chips' tick are faked; promises and user-event keep real timeouts
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(START);
    mockApi([['GET', `/api/recipes/${BEEF_CHILI_ID}`, json(beefChili)]]);
});

afterEach(() => {
    vi.useRealTimers();
});

/** Let time pass a second at a time, rendering in between as a real screen would. */
function pass(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        act(() => vi.advanceTimersByTime(Math.min(1000, ms - elapsed)));
    }
}
const timerBar = () => screen.getByRole('region', { name: 'Timers' });

/** Open the recipe and add a timer through the "New timer" sheet. */
async function addTimer(user: ReturnType<typeof renderApp>['user'], label: string, preset: string) {
    await user.click(await screen.findByRole('button', { name: 'Timer' }));
    const sheet = screen.getByRole('dialog', { name: 'New timer' });
    await user.type(within(sheet).getByLabelText('Label (optional)'), label);
    await user.click(within(sheet).getByRole('button', { name: preset }));
    await user.click(within(sheet).getByRole('button', { name: `Start ${parseInt(preset)}-minute timer` }));
}

describe('timers', () => {
    test('two run at once; one that ends rings, grows and waits to be dismissed', async () => {
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await addTimer(user, 'Stir', '5 min');
        expect(unlockAudio).toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await addTimer(user, 'Rice', '10 min');
        expect(timerBar()).toHaveTextContent('Stir 5:00');
        expect(timerBar()).toHaveTextContent('Rice 10:00');

        pass(2 * MINUTE);
        expect(timerBar()).toHaveTextContent('Stir 3:00');
        expect(timerBar()).toHaveTextContent('Rice 8:00');
        expect(within(timerBar()).getByText('Stir timer, 3 minutes left')).toBeInTheDocument();

        pass(3 * MINUTE);
        const done = within(timerBar()).getByRole('alert');
        expect(done).toHaveTextContent("Stir: time's up");
        expect(timerBar()).toHaveTextContent('Rice 5:00');
        expect(playChime).toHaveBeenCalledTimes(1);
        expect(vibrate).toHaveBeenCalledTimes(1);

        // It rings again until dismissed
        pass(RING_EVERY_MS);
        expect(playChime).toHaveBeenCalledTimes(2);

        await user.click(within(done).getByRole('button', { name: 'Dismiss' }));
        expect(within(timerBar()).queryByRole('alert')).not.toBeInTheDocument();
        expect(timerBar()).toHaveTextContent('Rice');
        pass(RING_EVERY_MS);
        expect(playChime).toHaveBeenCalledTimes(2);
    });

    test('a finished timer stops ringing after two minutes, but stays until dismissed', () => {
        startTimer(1, 'Pasta');
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        pass(MINUTE + RING_FOR_MS);
        const rings = vi.mocked(playChime).mock.calls.length;
        expect(rings).toBe(1 + RING_FOR_MS / RING_EVERY_MS);

        pass(5 * MINUTE);
        expect(playChime).toHaveBeenCalledTimes(rings);
        expect(within(timerBar()).getByRole('alert')).toHaveTextContent("Pasta: time's up");
    });

    test('with Timer sound off it only vibrates', () => {
        setPreference('timerSound', false);
        startTimer(1, '');
        renderApp('/options');

        pass(MINUTE);

        expect(within(timerBar()).getByRole('alert')).toHaveTextContent("Timer: time's up");
        expect(playChime).not.toHaveBeenCalled();
        expect(vibrate).toHaveBeenCalledTimes(1);
    });

    test('a running timer can be cancelled', async () => {
        startTimer(10, 'Oven check');
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('button', { name: 'Cancel Oven check timer' }));

        expect(screen.queryByRole('region', { name: 'Timers' })).not.toBeInTheDocument();
    });

    test('timers survive a reload, counting from when they end; one that ended meanwhile rings', () => {
        startTimer(3, 'Eggs');
        startTimer(20, 'Stock');
        const saved = localStorage.getItem('miseenplace.timers');
        expect(saved).toContain('Eggs');

        // Later, the app starts again: the store reads what was saved
        removeTimer('nothing');
        vi.setSystemTime(START.getTime() + 5 * MINUTE);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);
        pass(250);

        expect(within(timerBar()).getByRole('alert')).toHaveTextContent("Eggs: time's up");
        expect(timerBar()).toHaveTextContent('Stock 15:00');
        expect(playChime).toHaveBeenCalledTimes(1);
    });

    test('the sheet offers common lengths, exact minutes, and refuses nonsense', async () => {
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        await user.click(await screen.findByRole('button', { name: 'Timer' }));
        const sheet = screen.getByRole('dialog', { name: 'New timer' });

        expect(within(sheet).getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'true');
        await user.click(within(sheet).getByRole('button', { name: 'One minute more' }));
        expect(within(sheet).getByLabelText('Minutes')).toHaveValue('16');
        expect(within(sheet).getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'false');

        await user.clear(within(sheet).getByLabelText('Minutes'));
        await user.type(within(sheet).getByLabelText('Minutes'), '0');
        expect(within(sheet).getByText('Choose 1 to 600 minutes.')).toBeInTheDocument();
        expect(within(sheet).getByRole('button', { name: 'Start timer' })).toBeDisabled();

        await user.click(within(sheet).getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Timers' })).not.toBeInTheDocument();
    });

    test('the chips have an Add button too', async () => {
        startTimer(10, 'Rest');
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(within(timerBar()).getByRole('button', { name: 'Add a timer' }));

        expect(screen.getByRole('dialog', { name: 'New timer' })).toBeInTheDocument();
    });
});

describe("a step's timer (3b)", () => {
    const sectioned = {
        ...beefChili,
        sections: [
            section(BEEF_CHILI_ID, 0, 'Chilli', ['Fry the onions.', ['Simmer.', 20 * 60]]),
            section(BEEF_CHILI_ID, 1, 'To serve', [['Cook the rice.', 12 * 60]]),
        ],
    };

    test('starts with one tap; the step shows its time left, and its chip is named after the step', async () => {
        mockApi([['GET', `/api/recipes/${BEEF_CHILI_ID}`, json(sectioned)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        const method = await screen.findByRole('region', { name: 'Method' });
        // A step with no timer has no button
        expect(within(method).getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Start 20 min timer',
            'Start 12 min timer',
        ]);

        await user.click(within(method).getByRole('button', { name: 'Start 20 min timer' }));

        // The tap that starts it lets the page chime later
        expect(unlockAudio).toHaveBeenCalled();
        expect(within(timerBar()).getByText('Chilli, step 2 20:00')).toBeInTheDocument();
        expect(within(method).getByText('20:00 left')).toBeInTheDocument();
        expect(within(method).getByText('Chilli, step 2 timer running, 20 minutes left')).toBeInTheDocument();
        expect(within(method).queryByRole('button', { name: 'Start 20 min timer' })).not.toBeInTheDocument();
        expect(within(method).getByRole('button', { name: 'Start 12 min timer' })).toBeInTheDocument();

        pass(5 * MINUTE);
        expect(within(method).getByText('15:00 left')).toBeInTheDocument();

        // Once it rings, the step can start it again
        pass(15 * MINUTE);
        expect(within(timerBar()).getByRole('alert')).toHaveTextContent("Chilli, step 2: time's up");
        expect(within(method).getByRole('button', { name: 'Start 20 min timer' })).toBeInTheDocument();
    });

    test('a recipe with just "Method" names its timers "Step 3"; cancelling the chip frees the step', async () => {
        const timed = { ...beefChili, sections: [section(BEEF_CHILI_ID, 0, 'Method', ['Fry.', 'Stir.', ['Simmer.', 90]])] };
        mockApi([['GET', `/api/recipes/${BEEF_CHILI_ID}`, json(timed)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('button', { name: 'Start 1 min 30 s timer' }));
        expect(within(timerBar()).getByText('Step 3 1:30')).toBeInTheDocument();

        await user.click(within(timerBar()).getByRole('button', { name: 'Cancel Step 3 timer' }));
        expect(screen.getByRole('button', { name: 'Start 1 min 30 s timer' })).toBeInTheDocument();
    });
});

describe('formatRemaining and describeRemaining', () => {
    test.each([
        [5 * MINUTE, '5:00', '5 minutes'],
        [4 * MINUTE + 10_000, '4:10', '4 minutes 10 seconds'],
        [61_000, '1:01', '1 minute 1 second'],
        // Rounded up: it shows 0:01 until it has really ended
        [400, '0:01', '1 second'],
        [0, '0:00', '0 seconds'],
        [65 * MINUTE, '1:05:00', '1 hour 5 minutes'],
    ])('%i ms is "%s", or "%s"', (ms, shown, spoken) => {
        expect(formatRemaining(ms)).toBe(shown);
        expect(describeRemaining(ms)).toBe(spoken);
    });
});
