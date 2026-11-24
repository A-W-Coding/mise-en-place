import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { tag } from '../test/fixtures';
import { json, mockApi, page, renderApp, sent } from '../test/renderApp';

const beef = tag('beef', '#f6c7bd', 2);
const spicy = tag('spicy', '#ffd8c2', 3);
const unused = tag('brunch', null, 0);

describe('TagsPage (3b)', () => {
    test('lists every tag as its pill, with how many recipes use it', async () => {
        mockApi([['GET', '/api/tags', page([unused, beef, spicy])]]);
        renderApp('/options/tags');

        const list = await screen.findByRole('list', { name: 'Tags' });
        expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
            'Brunch0 recipes',
            'Beef2 recipes',
            'Spicy3 recipes',
        ]);
        expect(screen.getByText('3 tags')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to Options' })).toHaveAttribute('href', '/options');
    });

    test('renames a tag, and says when the name is taken', async () => {
        let taken = true;
        const fetchMock = mockApi([
            ['GET', '/api/tags', page([beef])],
            [
                'PATCH',
                `/api/tags/${beef.id}`,
                () => (taken ? json({ error: 'That name already exists.' }, { status: 409 }) : json({ ...beef, name: 'red meat' })),
            ],
        ]);
        const { user } = renderApp('/options/tags');

        await user.click(await screen.findByRole('button', { name: 'More options for Beef' }));
        await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
        const box = screen.getByRole('textbox', { name: 'Rename Beef' });
        await user.clear(box);
        await user.type(box, 'Red Meat');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Another tag is already called “red meat”.')).toBeInTheDocument();

        taken = false;
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rename Beef' })).not.toBeInTheDocument());
        expect(sent(fetchMock, 'PATCH').at(-1)?.body).toEqual({ name: 'red meat' });
    });

    test('changes a colour with the same chooser as a new tag', async () => {
        const fetchMock = mockApi([
            ['GET', '/api/tags', page([beef])],
            ['PATCH', `/api/tags/${beef.id}`, json({ ...beef, color: '#1f4e79' })],
        ]);
        const { user } = renderApp('/options/tags');

        await user.click(await screen.findByRole('button', { name: 'More options for Beef' }));
        await user.click(screen.getByRole('menuitem', { name: 'Change colour' }));
        const form = screen.getByRole('form', { name: 'Colour for Beef' });
        // Coral, its colour now, is chosen
        expect(within(form).getByRole('radio', { name: 'Coral' })).toHaveAttribute('aria-checked', 'true');
        const code = within(form).getByRole('textbox', { name: 'Colour code' });
        await user.clear(code);
        await user.type(code, '1F4E79');
        expect(within(form).getByRole('radio', { name: 'Coral' })).toHaveAttribute('aria-checked', 'false');
        await user.click(within(form).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(sent(fetchMock, 'PATCH')).toHaveLength(1));
        expect(sent(fetchMock, 'PATCH')[0]?.body).toEqual({ color: '#1f4e79' });
    });

    test('deleting asks first, saying how many recipes it comes off', async () => {
        const fetchMock = mockApi([
            ['GET', '/api/tags', page([spicy])],
            ['DELETE', `/api/tags/${spicy.id}`, json({ message: 'Tag deleted successfully.' })],
        ]);
        const { user } = renderApp('/options/tags');

        await user.click(await screen.findByRole('button', { name: 'More options for Spicy' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete the tag Spicy?' });
        expect(dialog).toHaveTextContent('It comes off 3 recipes; the recipes stay.');
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(sent(fetchMock, 'DELETE')).toHaveLength(1));
        expect(sent(fetchMock, 'DELETE')[0]?.path).toBe(`/api/tags/${spicy.id}`);
    });

    test('Options links to Tags and Equipment under Advanced', async () => {
        mockApi([['GET', '/api/health', json({ status: 'ok' })]]);
        renderApp('/options');

        expect(await screen.findByRole('link', { name: /^Tags/ })).toHaveAttribute('href', '/options/tags');
        expect(screen.getByRole('link', { name: /^Equipment/ })).toHaveAttribute('href', '/options/equipment');
    });
});

describe('EquipmentPage (3b)', () => {
    test('lists, renames and deletes items like ingredients, refusing one a recipe uses', async () => {
        const pan = { id: 'pan', name: 'large pan', createdAt: '', updatedAt: '' };
        mockApi([
            ['GET', '/api/equipment', page([pan])],
            ['DELETE', '/api/equipment/pan', json({ error: 'Cannot delete equipment that is used in recipes.' }, { status: 409 })],
        ]);
        const { user } = renderApp('/options/equipment');

        expect(await screen.findByRole('heading', { level: 1, name: 'Equipment' })).toBeInTheDocument();
        expect(await screen.findByText('1 item')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'More options for large pan' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete “large pan”?' });
        expect(dialog).toHaveTextContent("This can't be undone. An item a recipe still uses can't be deleted.");
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Can’t delete “large pan”: a recipe still uses it.'.replace('’', "'"));
    });
});
