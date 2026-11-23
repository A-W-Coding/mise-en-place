import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { BEEF_CHILI_ID, beefChili, beefChiliSummary, summary } from '../test/fixtures';
import { json, mockApi, page, renderApp } from '../test/renderApp';

interface FakeSentinel {
    released: boolean;
    release: ReturnType<typeof vi.fn>;
}

/** A stand-in Screen Wake Lock API that records requests, and can refuse them. */
function fakeWakeLock({ refuse = false } = {}) {
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(async () => {
        if (refuse) throw new DOMException('Battery saver is on.', 'NotAllowedError');
        const sentinel: FakeSentinel = {
            released: false,
            release: vi.fn(async () => {
                sentinel.released = true;
            }),
        };
        sentinels.push(sentinel);
        return sentinel;
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    return { request, sentinels };
}

function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(document, 'visibilityState');
});

const other = summary('Pancakes');

function mockRecipes() {
    mockApi([
        ['GET', `/api/recipes/${BEEF_CHILI_ID}`, json(beefChili)],
        ['GET', `/api/recipes/${other.id}`, json({ ...beefChili, ...other })],
        ['GET', '/api/recipes', page([beefChiliSummary])],
    ]);
}

describe('cooking mode', () => {
    test('the switch keeps the screen on, and turning it off lets it sleep', async () => {
        const { request, sentinels } = fakeWakeLock();
        mockRecipes();
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const panel = await screen.findByRole('region', { name: 'Cooking mode' });
        const toggle = within(panel).getByRole('switch', { name: 'Cooking mode' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(panel).toHaveTextContent('Keeps the screen on');

        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(request).toHaveBeenCalledWith('screen');
        expect(await within(panel).findByText('On: the screen stays on')).toBeInTheDocument();
        // The page itself doesn't change: the whole recipe is still there
        expect(screen.getByRole('region', { name: 'Method' })).toBeInTheDocument();

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(sentinels[0]?.release).toHaveBeenCalled();
    });

    test('the lock is taken again when the page becomes visible', async () => {
        const { request, sentinels } = fakeWakeLock();
        mockRecipes();
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        await user.click(await screen.findByRole('switch', { name: 'Cooking mode' }));
        await within(screen.getByRole('region', { name: 'Cooking mode' })).findByText('On: the screen stays on');

        // Switching apps: the browser drops the lock, then the page comes back
        setVisibility('hidden');
        sentinels[0]!.released = true;
        setVisibility('visible');

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    });

    test('leaving the recipe releases the lock, and another recipe starts with it off', async () => {
        const { sentinels } = fakeWakeLock();
        mockRecipes();
        const { user, router } = renderApp(`/recipes/${BEEF_CHILI_ID}`);
        await user.click(await screen.findByRole('switch', { name: 'Cooking mode' }));
        await vi.waitFor(() => expect(sentinels).toHaveLength(1));

        await act(() => router.navigate(`/recipes/${other.id}`));

        expect(await screen.findByRole('heading', { level: 1, name: 'Pancakes' })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Cooking mode' })).toHaveAttribute('aria-checked', 'false');
        expect(sentinels[0]?.release).toHaveBeenCalled();
    });

    test("says so when the browser can't keep the screen on", async () => {
        mockRecipes();
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('switch', { name: 'Cooking mode' }));

        expect(screen.getByRole('region', { name: 'Cooking mode' })).toHaveTextContent(
            "This browser can't keep the screen on, so it may sleep.",
        );
    });

    test('says so when the browser refuses', async () => {
        fakeWakeLock({ refuse: true });
        mockRecipes();
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}`);

        await user.click(await screen.findByRole('switch', { name: 'Cooking mode' }));

        expect(
            await within(screen.getByRole('region', { name: 'Cooking mode' })).findByText(
                "The browser wouldn't keep the screen on, so it may sleep.",
            ),
        ).toBeInTheDocument();
    });
});
