/**
 * @module web/src/api/mutations
 * The writes the pages make, as TanStack Query mutations.
 *
 * Each refreshes what it changed: a saved recipe goes straight into the
 * cache from the response, and the lists it might appear in are refetched.
 * "Right after it saves a change of its own" is one of the moments a device
 * refreshes (technical spec §3.4), so the offline copy refreshes too.
 *
 * Saving a recipe tries the Pi first. If it can't be reached, the change is
 * kept on the device to upload by itself later (D15), and the save still
 * succeeds, as `{ kind: 'waiting' }`.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { noteUnreachable, requestSync } from '../offline/sync';
import { recordSaved, sendRecipeChange } from '../offline/upload';
import { discardWaitingChange, keepWaitingChange, waitingChangeFor, type ChangeToKeep } from '../offline/waiting';
import { ApiError, apiRequest, type ApiResult } from './client';
import { queryKeys } from './queries';
import type { Recipe, RecipeImage } from './types';

const RECIPE_LISTS = ['recipes', 'list'] as const;

/** A save's outcome: on the server now, or waiting on the device to upload. */
export type SaveOutcome = { kind: 'uploaded'; result: ApiResult<Recipe> } | { kind: 'waiting' };

/** The status of a save that couldn't be kept on the device either: not a network error, so the editor shows its message. */
export const NOT_KEPT_STATUS = -1;

/**
 * Create a recipe (with the id the device chose) or save an edit (with
 * `If-Match`, F3), or keep it on the device when the Pi can't be reached.
 */
export function useSaveRecipe() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (save: ChangeToKeep): Promise<SaveOutcome> => {
            const waiting = waitingChangeFor(save.recipeId);
            try {
                const result = await sendRecipeChange({ ...save, sent: waiting?.sent ?? [] });
                return { kind: 'uploaded', result };
            } catch (error) {
                if (!(error instanceof ApiError) || !error.isNetworkError) throw error;
                try {
                    // It may have arrived with only its answer lost, so it's noted as sent
                    await keepWaitingChange(save, { sent: true });
                } catch (cause) {
                    console.warn("A change couldn't be kept on the device.", cause);
                    throw new ApiError(
                        NOT_KEPT_STATUS,
                        "Can't reach the server, and this device couldn't keep the recipe to upload later. Copy anything you'd miss, then try again.",
                    );
                }
                noteUnreachable();
                return { kind: 'waiting' };
            }
        },
        onSuccess: async (outcome, save) => {
            if (outcome.kind !== 'uploaded') return;
            // This version is on the server, so any older one waiting is done with
            await discardWaitingChange(save.recipeId).catch(() => {});
            await recordSaved(queryClient, outcome.result);
            requestSync();
        },
    });
}

/** Delete a recipe. With an ETag, a recipe changed since it was loaded is refused with 412. */
export function useDeleteRecipe() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, etag }: { id: string; etag?: string | null }) =>
            apiRequest<unknown>(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE', ifMatch: etag }),
        onSuccess: (_result, { id }) => {
            // A change still waiting for it would only upload to a recipe that's gone
            void discardWaitingChange(id).catch(() => {});
            void queryClient.invalidateQueries({ queryKey: RECIPE_LISTS });
            requestSync();
        },
    });
}

/** A shared list a recipe names things from (3b adds tags and equipment). */
export type SharedList = 'ingredients' | 'tags' | 'equipment';

function sharedPath(list: SharedList, id?: string): string {
    return id === undefined ? `/api/${list}` : `/api/${list}/${encodeURIComponent(id)}`;
}

/**
 * Add to a shared list: `{ name }`, and for a tag its `color`. The API trims
 * and lowercases the name.
 */
export function useCreateShared<T = { id: string; name: string }>(list: SharedList) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: { name: string; color?: string | null }) => apiRequest<T>(sharedPath(list), { method: 'POST', body }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: [list] });
            requestSync();
        },
    });
}

/**
 * Rename an ingredient, tag or item, or recolour a tag. Every recipe using
 * it shows the change, so recipes refresh too.
 */
export function useUpdateShared(list: SharedList) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string | null }) =>
            apiRequest<unknown>(sharedPath(list, id), { method: 'PATCH', body }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: [list] });
            void queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
            requestSync();
        },
    });
}

/**
 * Delete from a shared list. The API refuses with 409 an ingredient or item
 * a recipe uses; a tag comes off every recipe that has it, so recipes
 * refresh too.
 */
export function useDeleteShared(list: SharedList) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => apiRequest<unknown>(sharedPath(list, id), { method: 'DELETE' }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: [list] });
            if (list === 'tags') void queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
            requestSync();
        },
    });
}

/** Rename a shared ingredient. */
export function useRenameIngredient() {
    return useUpdateShared('ingredients');
}

/** Delete a shared ingredient. The API refuses with 409 while a recipe uses it. */
export function useDeleteIngredient() {
    return useDeleteShared('ingredients');
}

// ── Photos (3b) ─────────────────────────────────────────────────────────────
// Each needs the Pi: an upload is checked and re-encoded there, so there's no
// offline version. Afterwards the recipe and the lists refresh, and so does
// the offline copy, which caches the new thumbnail.

/** The things a photo change makes stale: the recipe, the lists' thumbnails, and the copy. */
function photosChanged(queryClient: ReturnType<typeof useQueryClient>, recipeId: string) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.recipe(recipeId) });
    void queryClient.invalidateQueries({ queryKey: RECIPE_LISTS });
    requestSync();
}

/** Add one photo to a recipe: the file as it was chosen, in the form field the API reads. */
export function useUploadPhoto(recipeId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (file: File) => {
            const form = new FormData();
            form.append('image', file, file.name);
            return apiRequest<RecipeImage>(`/api/recipes/${encodeURIComponent(recipeId)}/images`, { method: 'POST', body: form });
        },
        onSettled: () => photosChanged(queryClient, recipeId),
    });
}

/** Delete a photo and its files. If it was the main one, the API makes the next one main. */
export function useDeletePhoto(recipeId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (imageId: string) => apiRequest<unknown>(`/api/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' }),
        onSettled: () => photosChanged(queryClient, recipeId),
    });
}

/**
 * Make a photo the recipe's main one. It sends that one field and no
 * `If-Match`: it changes nothing else, so it can't overwrite an edit made
 * elsewhere.
 */
export function useSetMainPhoto(recipeId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (imageId: string) =>
            apiRequest<Recipe>(`/api/recipes/${encodeURIComponent(recipeId)}`, { method: 'PATCH', body: { primaryImageId: imageId } }),
        onSuccess: (result) => queryClient.setQueryData(queryKeys.recipe(recipeId), result),
        onSettled: () => photosChanged(queryClient, recipeId),
    });
}
