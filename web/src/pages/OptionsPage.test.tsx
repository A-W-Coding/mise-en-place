import { beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { resetPreferencesCache } from '../preferences';
import { playChime, unlockAudio, vibrate } from '../timers/sound';
import { json, mockApi, renderApp, unreachable } from '../test/renderApp';

vi.mock('../timers/sound');

const root = document.documentElement;

beforeEach(() => {
    localStorage.clear();
    resetPreferencesCache();
    delete root.dataset.theme;
    delete root.dataset.textSize;
});

describe('OptionsPage', () => {
    test('the theme follows the system until one is chosen, and the choice is saved', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        const { user } = renderApp('/options');

        const system = await screen.findByRole('button', { name: 'System' });
        expect(system).toHaveAttribute('aria-pressed', 'true');

        await user.click(screen.getByRole('button', { name: 'Dark' }));
        expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
        expect(system).toHaveAttribute('aria-pressed', 'false');
        expect(root.dataset.theme).toBe('dark');
        expect(JSON.parse(localStorage.getItem('miseenplace.preferences') ?? '{}')).toMatchObject({ theme: 'dark' });

        await user.click(system);
        expect(root.dataset.theme).toBeUndefined();
    });

    test('text size scales the page', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        const { user } = renderApp('/options');

        await user.click(await screen.findByRole('button', { name: 'Larger' }));

        expect(root.dataset.textSize).toBe('larger');
        expect(screen.getByRole('group', { name: 'Text size' })).toBeInTheDocument();
    });

    test('shows the server as reachable', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');

        expect(await screen.findByText('Server reachable')).toBeInTheDocument();
        expect(screen.getByText(/^Checked at /)).toBeInTheDocument();
    });

    test("says when it can't reach the server", async () => {
        mockApi([['GET', '/api/health', () => unreachable()]]);
        renderApp('/options');

        expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
        expect(screen.getByText('Check Tailscale is connected on this device.')).toBeInTheDocument();
    });

    test('says when the server is up but its database is not', async () => {
        mockApi([['GET', '/api/health', json({ status: 'error' }, { status: 503 })]]);
        renderApp('/options');

        expect(await screen.findByText('The server has a problem')).toBeInTheDocument();
        expect(screen.getByText("It's running, but its database isn't answering.")).toBeInTheDocument();
    });

    test('Advanced leads to the ingredient list', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');

        expect(await screen.findByRole('link', { name: /Ingredients/ })).toHaveAttribute('href', '/options/ingredients');
    });
    test('the timer sound can be turned off, and tested', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        const { user } = renderApp('/options');

        const toggle = await screen.findByRole('switch', { name: 'Timer sound' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(/Timers ring while the app is on screen/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Test' }));
        expect(unlockAudio).toHaveBeenCalled();
        expect(playChime).toHaveBeenCalledTimes(1);
        expect(vibrate).toHaveBeenCalledTimes(1);

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(JSON.parse(localStorage.getItem('miseenplace.preferences') ?? '{}')).toMatchObject({ timerSound: false });
    });
});
