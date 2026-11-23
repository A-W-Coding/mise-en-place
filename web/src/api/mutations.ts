/**
 * @module web/src/api/mutations
 * The writes the pages make, as TanStack Query mutations.
 *
 * Each refreshes what it changed: a saved recipe goes straight into the
 * cache from the response, and the lists it might appear in are refetched.
 * "Right after it saves a change of its own" is one of the moments a device
 * refreshes (technical spec §3.4).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RecipeBody } from '../editor/draft';
import { apiRequest } from './client';
import { queryKeys } from './queries';
import type { Ingredient, Recipe } from './types';

const RECIPE_LISTS = ['recipes', 'list'] as const;
const INGREDIENTS = ['ingredients'] as const;

interface SaveRecipe {
    /** Absent for a new recipe. */
    id?: string;
    body: RecipeBody;
    /** The version being edited, sent as `If-Match` so a change made elsewhere isn't overwritten (F3). */
    etag?: string | null;
}

/** Create a recipe, or replace an existing one's fields and lines. */
export function useSaveRecipe() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, body, etag }: SaveRecipe) =>
            id
                ? apiRequest<Recipe>(`/api/recipes/${encodeURIComponent(id)}`, { method: 'PATCH', body, ifMatch: etag })
                : apiRequest<Recipe>('/api/recipes', { method: 'POST', body }),
        onSuccess: (result) => {
            queryClient.setQueryData(queryKeys.recipe(result.data.id), result);
            void queryClient.invalidateQueries({ queryKey: RECIPE_LISTS });
        },
    });
}

/** Delete a recipe. With an ETag, a recipe changed since it was loaded is refused with 412. */
export function useDeleteRecipe() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, etag }: { id: string; etag?: string | null }) =>
            apiRequest<unknown>(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE', ifMatch: etag }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: RECIPE_LISTS }),
    });
}

/** Add a shared ingredient. The API trims and lowercases the name. */
export function useCreateIngredient() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (name: string) => apiRequest<Ingredient>('/api/ingredients', { method: 'POST', body: { name } }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: INGREDIENTS }),
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
        },
    });
}

/** Delete a shared ingredient. The API refuses with 409 while a recipe uses it. */
export function useDeleteIngredient() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => apiRequest<unknown>(`/api/ingredients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: INGREDIENTS }),
    });
}
