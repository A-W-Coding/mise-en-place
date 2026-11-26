import { describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Recipe } from '../api/types';
import { BEEF_CHILI_ID, beefChili, photo, seedCopy, withPhotos } from '../test/fixtures';
import { json, mockApi, renderApp, sent, unreachable } from '../test/renderApp';
import { keepWaitingChange } from '../offline/waiting';

const RECIPE_PATH = `/api/recipes/${BEEF_CHILI_ID}`;
const UPLOAD_PATH = `${RECIPE_PATH}/images`;

/** A chosen file, as the browser's file picker gives it. */
function file(name: string, type = 'image/jpeg', bytes = 2048): File {
    return new File([new Uint8Array(bytes)], name, { type });
}

/** Choose files with the Add photo button, as the phone's picker would. */
function choose(...files: File[]) {
    fireEvent.change(screen.getByLabelText('Add photo'), { target: { files } });
}

const tiles = () => within(screen.getByRole('list', { name: 'Photos' })).getAllByRole('listitem');

describe('PhotosPage (3b)', () => {
    test('shows the photos in upload order, the main one marked, and how many of 10', async () => {
        mockApi([['GET', RECIPE_PATH, json(withPhotos(beefChili, 3, 1))]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);

        // The heading shows while it loads; the count once the recipe is here
        expect(await screen.findByText('3 of 10')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Photos' })).toBeInTheDocument();
        expect(tiles()).toHaveLength(3);
        expect(within(tiles()[1]!).getByText('Main')).toBeInTheDocument();
        expect(within(tiles()[0]!).queryByText('Main')).not.toBeInTheDocument();
        expect(screen.getByText(/JPEG, PNG or WebP, up to 15 MB\. Location and other details are removed\./)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to Beef Chili' })).toHaveAttribute('href', `/recipes/${BEEF_CHILI_ID}`);
    });

    test('Add photo sends each file in the field "image", one after another, then shows them', async () => {
        let current: Recipe = withPhotos(beefChili, 1);
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, () => json(current)],
            [
                'POST',
                UPLOAD_PATH,
                () => {
                    const added = photo(BEEF_CHILI_ID, current.images.length);
                    current = { ...current, images: [...current.images, added] };
                    return json(added, { status: 201 });
                },
            ],
        ]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);
        await screen.findByText('1 of 10');

        choose(file('pan.jpg'), file('bowl.png', 'image/png'));

        await waitFor(() => expect(screen.getByText('3 of 10')).toBeInTheDocument());
        const uploads = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(uploads.map(([, init]) => ((init!.body as FormData).get('image') as File).name)).toEqual(['pan.jpg', 'bowl.png']);
        expect(tiles()).toHaveLength(3);
    });

    test('a refused file is named in its message; one over 15 MB is refused before it is sent', async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(withPhotos(beefChili, 1))],
            ['POST', UPLOAD_PATH, json({ error: 'Only JPEG, PNG and WebP images are accepted.' }, { status: 415 })],
        ]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);
        await screen.findByText('1 of 10');
        const huge = file('huge.jpg');
        Object.defineProperty(huge, 'size', { value: 15 * 1024 * 1024 + 1 });

        choose(file('party.gif', 'image/gif'), huge);

        const alert = await screen.findByRole('alert');
        await waitFor(() => expect(alert).toHaveTextContent("party.gif wasn't added. Only JPEG, PNG and WebP images are accepted."));
        expect(alert).toHaveTextContent("huge.jpg wasn't added. Images can be at most 15 MB.");
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    });

    test('only as many as fit are sent; a recipe with 10 says so and can add no more', async () => {
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(withPhotos(beefChili, 9))],
            ['POST', UPLOAD_PATH, json(photo(BEEF_CHILI_ID, 9), { status: 201 })],
        ]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);
        await screen.findByText('9 of 10');

        choose(file('a.jpg'), file('b.jpg'), file('c.jpg'));

        expect(await screen.findByRole('alert')).toHaveTextContent("Only 1 more photo fits, so b.jpg, c.jpg weren't added.");
        await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    });

    test('a recipe with 10 photos explains the limit, and Add photo is off', async () => {
        mockApi([['GET', RECIPE_PATH, json(withPhotos(beefChili, 10))]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);

        expect(await screen.findByText('This recipe has 10 photos, the most it can have. Delete one to add another.')).toBeInTheDocument();
        expect(screen.getByLabelText('Add photo')).toBeDisabled();
    });

    test("a photo's ⋮ menu makes it the main one", async () => {
        let recipe = withPhotos(beefChili, 3);
        const second = recipe.images[1]!;
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, () => json(recipe)],
            [
                'PATCH',
                RECIPE_PATH,
                () => {
                    recipe = { ...recipe, primaryImageId: second.id };
                    return json(recipe);
                },
            ],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);

        await user.click(await screen.findByRole('button', { name: 'Options for Photo 1 of Beef Chili' }));
        expect(screen.getByRole('menuitem', { name: /Make main photo/ })).toHaveAttribute('aria-disabled', 'true');
        await user.keyboard('{Escape}');
        await user.click(screen.getByRole('button', { name: 'Options for Photo 2 of Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Make main photo' }));

        await waitFor(() => expect(within(tiles()[1]!).getByText('Main')).toBeInTheDocument());
        expect(sent(fetchMock, 'PATCH')[0]?.body).toEqual({ primaryImageId: second.id });
        // One field, nothing else to overwrite, so no If-Match
        expect(sent(fetchMock, 'PATCH')[0]?.headers['If-Match']).toBeUndefined();
    });

    test('deleting asks first, saying the next photo becomes the main one', async () => {
        const recipe = withPhotos(beefChili, 2);
        const fetchMock = mockApi([
            ['GET', RECIPE_PATH, json(recipe)],
            ['DELETE', `/api/images/${recipe.images[0]!.id}`, json({ message: 'Image deleted successfully.' })],
        ]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);

        await user.click(await screen.findByRole('button', { name: 'Options for Photo 1 of Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete photo…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete this photo?' });
        expect(dialog).toHaveTextContent("This can't be undone. The next photo becomes the main one.");
        await user.click(within(dialog).getByRole('button', { name: 'Delete photo' }));

        await waitFor(() => expect(sent(fetchMock, 'DELETE')).toHaveLength(1));
        expect(sent(fetchMock, 'DELETE')[0]?.path).toBe(`/api/images/${recipe.images[0]!.id}`);
    });

    test('View full size opens the photo over the page, and Close returns', async () => {
        const recipe = withPhotos(beefChili, 2);
        mockApi([['GET', RECIPE_PATH, json(recipe)]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);

        await user.click(await screen.findByRole('button', { name: 'Options for Photo 2 of Beef Chili' }));
        await user.click(screen.getByRole('menuitem', { name: 'View full size' }));

        const viewer = screen.getByRole('dialog', { name: 'Photo 2 of Beef Chili' });
        expect(within(viewer).getByRole('img', { name: 'Photo 2 of Beef Chili' })).toHaveAttribute('src', `/media/${recipe.images[1]!.id}.webp`);
        await user.click(within(viewer).getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('offline, Add photo is off and says it needs a connection', async () => {
        const recipe = withPhotos(beefChili, 2);
        await seedCopy([recipe]);
        mockApi([['GET', RECIPE_PATH, unreachable]]);
        const { user } = renderApp(`/recipes/${BEEF_CHILI_ID}/photos`);

        expect(await screen.findByText(/Adding a photo needs a connection to the server/)).toBeInTheDocument();
        expect(screen.getByLabelText('Add photo')).toBeDisabled();
        expect(tiles()).toHaveLength(2);
        await user.click(screen.getByRole('button', { name: 'Options for Photo 2 of Beef Chili' }));
        expect(screen.getByRole('menuitem', { name: /Delete photo/ })).toHaveAttribute('aria-disabled', 'true');
    });

    test('a new recipe still on this device says to add photos once it has uploaded', async () => {
        const id = 'aaaaaaaa-0000-4000-8000-000000000009';
        await keepWaitingChange({
            recipeId: id,
            kind: 'create',
            etag: null,
            body: { name: 'Soda Bread', description: null, servings: 1, prepTime: null, cookTime: null, sections: [], ingredients: [], tags: [], equipment: [] },
        });
        mockApi([['GET', `/api/recipes/${id}`, json({ error: 'Recipe not found.' }, { status: 404 })]]);
        renderApp(`/recipes/${id}/photos`);

        expect(await screen.findByText(/Add photos once it's uploaded/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Add photo')).not.toBeInTheDocument();
    });
});

describe('the main photo on the recipe page, and thumbnails on the list (3b)', () => {
    test('the main photo heads the recipe, saying how many there are, and opens the Photos page', async () => {
        const recipe = withPhotos(beefChili, 3, 2);
        mockApi([['GET', RECIPE_PATH, json(recipe)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        const link = await screen.findByRole('link', { name: "Beef Chili's photos: 3 photos" });
        expect(link).toHaveAttribute('href', `/recipes/${BEEF_CHILI_ID}/photos`);
        expect(link).toHaveTextContent('3 photos');
        expect(link.querySelector('img')).toHaveAttribute('src', `/media/${recipe.images[2]!.id}.webp`);
    });

    test('a recipe with no photos offers to add one', async () => {
        mockApi([['GET', RECIPE_PATH, json(beefChili)]]);
        renderApp(`/recipes/${BEEF_CHILI_ID}`);

        expect(await screen.findByRole('link', { name: 'Add photos' })).toHaveAttribute('href', `/recipes/${BEEF_CHILI_ID}/photos`);
    });

    test("the list shows each recipe's main photo as a thumbnail, and a plate for one with none", async () => {
        const main = photo(BEEF_CHILI_ID, 0);
        mockApi([
            [
                'GET',
                '/api/recipes',
                json([
                    { ...beefChili, primaryImageId: main.id },
                    { ...beefChili, id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'Toast', primaryImageId: null },
                ], { headers: { 'X-Total-Count': '2' } }),
            ],
        ]);
        renderApp('/');

        const chili = (await screen.findByRole('link', { name: /Beef Chili/ })).querySelector('img');
        expect(chili).toHaveAttribute('src', `/media/${main.id}-thumb.webp`);
        expect(screen.getByRole('link', { name: /Toast/ }).querySelector('img')).toBeNull();
    });
});
