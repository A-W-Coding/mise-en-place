import { act, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
    BEEF_CHILI_ID,
    DAY_MS,
    beefChili,
    beefChiliSummary,
    lemonDrizzle,
    seedCopy,
    snapshotOf,
    summary,
} from '../test/fixtures';
import { json, mockApi, page, renderApp, requestedUrls, unreachable } from '../test/renderApp';
import { startSync } from './sync';

const RECIPE_PATH = `/api/recipes/${BEEF_CHILI_ID}`;
/** The offline banner, if it's showing. */
function banner(): HTMLElement | null {
    return (
        screen
            .queryAllByRole('status')
            .find((element) => element.textContent?.includes('Showing the copy saved on this device')) ?? null
    );
}

/** The banner, once it shows: it follows the page's data a moment later. */
async function findBanner(): Promise<HTMLElement> {
    return waitFor(() => {
        const found = banner();
        if (!found) throw new Error('No offline banner yet.');
        return found;
    });
}

afterEach(() => {
    vi.useRealTimers();
    // A stand-in StorageManager, where a test set one
    delete (navigator as { storage?: unknown }).storage;
});

describe('pages, when the server can\'t be reached', () => {
    test('the list reads from the copy, with a banner giving its age', async () => {
        await seedCopy([beefChili, lemonDrizzle], 3 * DAY_MS);
        mockApi([['GET', '/api/recipes', () => unreachable()]]);
        renderApp('/');

        expect(await screen.findByRole('link', { name: /Beef Chili/ })).toHaveTextContent('Serves 2 · 20 min prep · 2 h cook');
        expect(screen.getByRole('link', { name: /Lemon Drizzle Cake/ })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
        expect(await findBanner()).toHaveTextContent(
            "Can't reach the server. Showing the copy saved on this device, refreshed 3 days ago.",
        );
        // The copy answered, so there's no error
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('search runs on the device', async () => {
        await seedCopy([beefChili, lemonDrizzle]);
        mockApi([['GET', '/api/recipes', () => unreachable()]]);
        const { user } = renderApp('/');
        const searchBox = await screen.findByRole('searchbox', { name: 'Search recipes' });
        await screen.findByText('2 recipes');

        await user.type(searchBox, 'drizzle cake');
        expect(await screen.findByText('1 match')).toBeInTheDocument();
        expect(within(screen.getByRole('list', { name: 'Recipes' })).getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByRole('link', { name: /Lemon Drizzle Cake/ })).toBeInTheDocument();

        await user.clear(searchBox);
        await user.type(searchBox, 'risotto');
        expect(await screen.findByText('No recipes match “risotto”')).toBeInTheDocument();
    });

    test('a recipe opens from the copy, whole, with cooking mode', async () => {
        await seedCopy([beefChili], DAY_MS);
        mockApi([['GET', RECIPE_PATH, () => unreachable()]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Ingredients' })).getAllByRole('listitem')).toHaveLength(7);
        expect(within(screen.getByRole('region', { name: 'Method' })).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('switch', { name: 'Cooking mode' })).toBeInTheDocument();
        expect(await findBanner()).toHaveTextContent('refreshed yesterday.');
    });

    test("a recipe the copy hasn't got shows the error, as it would with no copy", async () => {
        await seedCopy([lemonDrizzle]);
        mockApi([['GET', RECIPE_PATH, () => unreachable()]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.");
        expect(banner()).toBeNull();
    });

    test('with no copy yet, the page shows the error and no banner', async () => {
        mockApi([['GET', '/api/recipes', () => unreachable()]]);
        renderApp('/');

        expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.");
        expect(banner()).toBeNull();
    });

    test('Options › Ingredients reads from the copy', async () => {
        await seedCopy([beefChili]);
        mockApi([['GET', '/api/ingredients', () => unreachable()]]);
        renderApp('/options/ingredients');

        expect(await screen.findByText('7 ingredients')).toBeInTheDocument();
        const rows = within(screen.getByRole('list', { name: 'Ingredients' })).getAllByRole('listitem');
        expect(rows.map((row) => row.textContent?.replace(/More options.*/, ''))).toEqual([
            'beef mince',
            'cayenne pepper',
            'garlic',
            'onion',
            'red pepper',
            'smoked paprika',
            'sweetcorn',
        ]);
        await findBanner();
    });

    test('the editor opens a recipe from the copy, to edit offline (Step 17)', async () => {
        await seedCopy([beefChili]);
        mockApi([['GET', RECIPE_PATH, () => unreachable()]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        expect(await screen.findByLabelText('Name')).toHaveValue('Beef Chili');
        expect(screen.getByRole('combobox', { name: 'Ingredient, line 1' })).toHaveValue('onion');
    });

    test("saving while the browser says it's offline doesn't wait: the recipe is kept on the device", async () => {
        mockApi([['POST', '/api/recipes', () => unreachable()]]);
        const { user } = renderApp('/recipes/new');
        await user.type(await screen.findByLabelText('Name'), 'Toast');

        // TanStack Query's default would hold the save back until the browser said it was online again
        act(() => onlineManager.setOnline(false));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Toast' })).toBeInTheDocument();
        expect(screen.getByText(/Waiting to upload\./)).toBeInTheDocument();
    });

    test('once the server answers again, the page fetches from it by itself, and the banner goes', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let reachable = false;
        const bananaBread = summary('Banana Bread');
        mockApi([
            ['GET', '/api/recipes', () => (reachable ? page([bananaBread, beefChiliSummary]) : unreachable())],
            [
                'GET',
                '/api/sync',
                () => (reachable ? json(snapshotOf([beefChili]), { headers: { ETag: '"s2"' } }) : unreachable()),
            ],
        ]);
        await seedCopy([beefChili]);
        const { queryClient } = renderApp('/');
        startSync(queryClient);
        await screen.findByText('1 recipe');
        await findBanner();

        reachable = true;
        await act(() => vi.advanceTimersByTimeAsync(15_000));

        expect(await screen.findByRole('link', { name: /Banana Bread/ })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
        expect(banner()).toBeNull();
    });

    test("the banner's Retry tries again at once, and Refresh refreshes the copy too", async () => {
        let reachable = false;
        const fetchMock = mockApi([
            ['GET', '/api/recipes', () => (reachable ? page([beefChiliSummary]) : unreachable())],
            [
                'GET',
                '/api/sync',
                () => (reachable ? json(snapshotOf([beefChili]), { headers: { ETag: '"s2"' } }) : unreachable()),
            ],
        ]);
        await seedCopy([beefChili]);
        const { queryClient, user } = renderApp('/');
        startSync(queryClient);
        await screen.findByText('1 recipe');
        const syncRequests = () => requestedUrls(fetchMock).filter((url) => url.pathname === '/api/sync').length;
        await waitFor(() => expect(syncRequests()).toBe(1));

        reachable = true;
        await user.click(within(await findBanner()).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(banner()).toBeNull());
        expect(syncRequests()).toBe(2);

        await user.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(syncRequests()).toBe(3));
    });
});

describe('Options › Offline copy', () => {
    function offlineSection() {
        return screen.getByRole('region', { name: 'Offline copy' });
    }

    function fakeStorageManager({ persisted = false, granted = true } = {}) {
        const storage = { persisted: vi.fn(async () => persisted), persist: vi.fn(async () => granted) };
        Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
        return storage;
    }

    test('says how many recipes are on the device, and when they were refreshed', async () => {
        await seedCopy([beefChili, lemonDrizzle], 2 * 60 * 60 * 1000);
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');

        expect(await within(offlineSection()).findByText('2 recipes on this device')).toBeInTheDocument();
        expect(within(offlineSection()).getByText(/^Refreshed 2 hours ago\./)).toBeInTheDocument();
    });

    test('before the first refresh, says nothing is saved yet', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');

        expect(await within(offlineSection()).findByText('Not saved yet')).toBeInTheDocument();
    });

    test('Protect asks the browser to keep the copy, from the tap', async () => {
        const storage = fakeStorageManager({ persisted: false, granted: true });
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        const { user } = renderApp('/options');
        const section = await screen.findByRole('region', { name: 'Offline copy' });
        expect(
            await within(section).findByText('Not protected: the browser may clear it if this device runs low on space.'),
        ).toBeInTheDocument();

        await user.click(within(section).getByRole('button', { name: 'Protect' }));

        expect(storage.persist).toHaveBeenCalledTimes(1);
        expect(await within(section).findByText("Protected: the browser won't clear it to free up space.")).toBeInTheDocument();
        expect(within(section).queryByRole('button', { name: 'Protect' })).not.toBeInTheDocument();
    });

    test('a refusal says so, and Protect stays to try again', async () => {
        fakeStorageManager({ persisted: false, granted: false });
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        const { user } = renderApp('/options');
        const section = await screen.findByRole('region', { name: 'Offline copy' });

        await user.click(await within(section).findByRole('button', { name: 'Protect' }));

        expect(await within(section).findByText("Not protected: the browser didn't allow it.")).toBeInTheDocument();
        expect(within(section).getByRole('button', { name: 'Protect' })).toBeInTheDocument();
    });

    test('storage already protected needs no button', async () => {
        fakeStorageManager({ persisted: true });
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');
        const section = await screen.findByRole('region', { name: 'Offline copy' });

        expect(await within(section).findByText(/^Protected:/)).toBeInTheDocument();
        expect(within(section).queryByRole('button', { name: 'Protect' })).not.toBeInTheDocument();
    });

    test("a browser that can't protect it says so", async () => {
        Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');

        expect(await within(offlineSection()).findByText(/^This browser can't protect it/)).toBeInTheDocument();
    });

    test('a failed refresh says so, and Refresh now tries again', async () => {
        let reachable = false;
        mockApi([
            ['GET', '/api/health', json({ status: 'ok' })],
            [
                'GET',
                '/api/sync',
                () => (reachable ? json(snapshotOf([beefChili]), { headers: { ETag: '"s1"' } }) : unreachable()),
            ],
        ]);
        const { queryClient, user } = renderApp('/options');
        startSync(queryClient);
        const section = await screen.findByRole('region', { name: 'Offline copy' });

        expect(
            await within(section).findByText(
                "The last refresh failed: Can't reach the server. It tries again by itself while the app is open.",
            ),
        ).toBeInTheDocument();

        reachable = true;
        await user.click(within(section).getByRole('button', { name: 'Refresh now' }));

        expect(await within(section).findByText('1 recipe on this device')).toBeInTheDocument();
        expect(within(section).queryByText(/The last refresh failed/)).not.toBeInTheDocument();
    });
});

describe('the copy at once, while the API is asked (Step 19)', () => {
    /** An API answer that hasn't come yet: call `answer` to send it, or `fail` for no answer at all. */
    function slowAnswer() {
        let answer: (response: Response) => void = () => {};
        let fail: () => void = () => {};
        const respond = () =>
            new Promise<Response>((resolve, reject) => {
                answer = resolve;
                fail = () => reject(new TypeError('Failed to fetch'));
            });
        return { respond, answer: (response: Response) => answer(response), fail: () => fail() };
    }

    test("the list shows the copy straight away, with no banner, and the API's answer replaces it", async () => {
        await seedCopy([beefChili]);
        const slow = slowAnswer();
        mockApi([['GET', '/api/recipes', slow.respond]]);
        renderApp('/');

        expect(await screen.findByRole('link', { name: /Beef Chili/ })).toBeInTheDocument();
        expect(screen.queryByText('Loading recipes…')).not.toBeInTheDocument();
        expect(banner()).toBeNull();

        act(() => slow.answer(page([beefChiliSummary, summary('Banana Bread')])));
        expect(await screen.findByRole('link', { name: /Banana Bread/ })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
        expect(banner()).toBeNull();
    });

    test('if the API turns out to be out of reach, the copy stays, and only then the banner says so', async () => {
        await seedCopy([beefChili]);
        const slow = slowAnswer();
        mockApi([['GET', `/api/recipes/${BEEF_CHILI_ID}`, slow.respond]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
        expect(banner()).toBeNull();

        act(() => slow.fail());
        expect(await findBanner()).toHaveTextContent("Can't reach the server.");
        expect(screen.getByRole('heading', { level: 1, name: 'Beef Chili' })).toBeInTheDocument();
    });

    test("the editor waits for the API's version, so an older copy isn't edited", async () => {
        await seedCopy([beefChili]);
        const slow = slowAnswer();
        mockApi([['GET', `/api/recipes/${BEEF_CHILI_ID}`, slow.respond]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/edit`);

        expect(await screen.findByText('Loading recipe…')).toBeInTheDocument();
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

        act(() => slow.answer(json({ ...beefChili, description: 'Newer.' }, { headers: { ETag: '"9"' } })));
        expect(await screen.findByLabelText('Description')).toHaveValue('Newer.');
    });

    test('the ingredient picker suggests from the copy straight away, and offers to create a new one', async () => {
        await seedCopy([beefChili]);
        mockApi([['GET', '/api/ingredients', slowAnswer().respond]]);
        const { user } = renderApp('/recipes/new');

        await user.type(await screen.findByRole('combobox', { name: 'Ingredient, line 1' }), 'pepper');
        expect(await screen.findByRole('option', { name: 'red pepper' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'cayenne pepper' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Create ingredient “pepper”' })).toBeInTheDocument();
    });
});
