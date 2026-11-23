/**
 * @module web/src/components/DeleteRecipeDialog
 * "Delete Beef Chili?", from a ⋮ menu or the editor, always confirmed
 * (technical spec §3.4).
 *
 * Where the page has the recipe's ETag (its own page, or the editor), the
 * delete sends it, so a recipe changed elsewhere since it was loaded isn't
 * deleted unseen: the dialog says so instead, and the recipe refreshes. A
 * recipe already deleted elsewhere counts as done.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../api/errorMessage';
import { useDeleteRecipe } from '../api/mutations';
import { queryKeys } from '../api/queries';
import { ConfirmDialog } from './ConfirmDialog';

interface DeleteRecipeDialogProps {
    /** The recipe to delete; the dialog is open while this is set. */
    recipe: { id: string; name: string } | null;
    etag?: string | null;
    onClose: () => void;
    onDeleted: () => void;
}

export function DeleteRecipeDialog({ recipe, etag, onClose, onDeleted }: DeleteRecipeDialogProps) {
    const queryClient = useQueryClient();
    const deletion = useDeleteRecipe();
    const [error, setError] = useState<string | null>(null);

    const close = () => {
        setError(null);
        deletion.reset();
        onClose();
    };

    const confirm = () => {
        if (!recipe) return;
        setError(null);
        deletion.mutate(
            { id: recipe.id, etag },
            {
                onSuccess: onDeleted,
                onError: (failure) => {
                    if (failure.status === 404) {
                        onDeleted();
                    } else if (failure.status === 412) {
                        setError('This recipe changed on another device since it was loaded. Check the latest version first.');
                        void queryClient.invalidateQueries({ queryKey: queryKeys.recipe(recipe.id) });
                    } else {
                        setError(errorMessage(failure));
                    }
                },
            },
        );
    };

    return (
        <ConfirmDialog
            open={recipe !== null}
            title={`Delete ${recipe?.name ?? 'recipe'}?`}
            confirmLabel="Delete"
            tone="danger"
            busy={deletion.isPending}
            error={error}
            onConfirm={confirm}
            onCancel={close}
        >
            <p>This can't be undone. Its ingredients stay in the shared list.</p>
        </ConfirmDialog>
    );
}
