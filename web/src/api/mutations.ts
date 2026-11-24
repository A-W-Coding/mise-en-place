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
import type { Ingredient, Recipe } from './types';

const RECIPE_LISTS = ['recipes', 'list'] as const;
const INGREDIENTS = ['ingredients'] as const;

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

/** Add a shared ingredient. The API trims and lowercases the name. */
export function useCreateIngredient() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (name: string) => apiRequest<Ingredient>('/api/ingredients', { method: 'POST', body: { name } }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: INGREDIENTS });
            requestSync();
        },
    });
}

/** Rename a shared ingredient. Every recipe using it shows the new name, so recipes refresh too. */
export function useRenameIngredient() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            apiRequest<Ingredient>(`/api/ingredients/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: INGREDIENTS });
            void queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
            requestSync();
        },
    });
}

/** Delete a shared ingredient. The API refuses with 409 while a recipe uses it. */
export function useDeleteIngredient() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => apiRequest<unknown>(`/api/ingredients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: INGREDIENTS });
            requestSync();
        },
    });
}
