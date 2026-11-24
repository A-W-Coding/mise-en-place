/**
 * @module web/src/api/queries
 * The reads the pages make, as TanStack Query hooks, and their cache keys.
 *
 * Lists load a page at a time (`useInfiniteQuery`): the next page's offset is
 * the number of items loaded so far, until that reaches `X-Total-Count` (D6).
 *
 * When the API can't be reached, the recipe list, a recipe and the ingredient
 * list are answered from the offline copy instead (3c), marked `fromCopy`.
 * Search then runs on the device.
 */

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { loadOfflineCopy, type OfflineCopy } from '../offline/copy';
import { listFromCopy, recipeFromCopy, type ReadResult } from '../offline/read';
import { noteUnreachable } from '../offline/sync';
import { ApiError, apiRequest } from './client';
import type { Ingredient, Recipe, RecipeSummary } from './types';

/**
 * Items per page. Small enough that the first page arrives quickly on the
 * phone, and big enough to fill a desktop screen of tiles.
 */
export const PAGE_SIZE = 20;

/** Cache keys. Everything about recipes starts with 'recipes', so one key can refresh it all. */
export const queryKeys = {
    recipes: ['recipes'] as const,
    recipeList: (search: string) => ['recipes', 'list', search] as const,
    recipe: (id: string) => ['recipes', 'detail', id] as const,
    ingredientList: (search: string) => ['ingredients', 'list', search] as const,
    health: ['health'] as const,
};

function listPath(resource: string, search: string, offset: number): string {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (search) params.set('search', search);
    return `/api/${resource}?${params}`;
}

/**
 * Ask the API, or answer from the offline copy if the API can't be reached.
 * When the copy can't answer either (there's none yet, or it hasn't the
 * recipe), the network error stands, and the page shows it as in 3a.
 */
async function withOfflineCopy<T>(
    request: () => Promise<ReadResult<T>>,
    fromCopy: (copy: OfflineCopy) => ReadResult<T> | null,
): Promise<ReadResult<T>> {
    try {
        return await request();
    } catch (error) {
        if (!(error instanceof ApiError) || !error.isNetworkError) throw error;
        noteUnreachable();
        const copy = await loadOfflineCopy();
        const answer = copy && fromCopy(copy);
        if (!answer) throw error;
        return answer;
    }
}

/** One list, page by page, optionally searched. The previous results stay on screen while a new search loads. */
function useInfiniteList<T extends { name: string }>(
    resource: 'recipes' | 'ingredients',
    queryKey: readonly unknown[],
    search: string,
    itemsInCopy: (copy: OfflineCopy) => T[],
) {
    const query = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam, signal }) =>
            withOfflineCopy(
                () => apiRequest<T[]>(listPath(resource, search, pageParam), { signal }),
                (copy) => listFromCopy(itemsInCopy(copy), search, pageParam, PAGE_SIZE),
            ),
        initialPageParam: 0,
        getNextPageParam: (lastPage: ReadResult<T[]>, pages) => {
            const loaded = pages.reduce((count, page) => count + page.data.length, 0);
            // An empty page also stops, in case the total shrank while paging
            return lastPage.data.length > 0 && loaded < (lastPage.totalCount ?? 0) ? loaded : undefined;
        },
        placeholderData: keepPreviousData,
    });

    const items = query.data?.pages.flatMap((page) => page.data) ?? [];
    const total = query.data?.pages[0]?.totalCount ?? null;
    return { ...query, items, total };
}

/** The recipe list, as summaries. */
export function useRecipeList(search: string) {
    return useInfiniteList<RecipeSummary>('recipes', queryKeys.recipeList(search), search, (copy) => copy.data.recipes);
}

/** The shared ingredient list. */
export function useIngredientList(search: string) {
    return useInfiniteList<Ingredient>(
        'ingredients',
        queryKeys.ingredientList(search),
        search,
        (copy) => copy.data.ingredients,
    );
}

/**
 * One whole recipe. `data.etag` is kept for the editor's `If-Match` (Step
 * 12); a recipe from the offline copy has none.
 */
export function useRecipe(id: string) {
    return useQuery({
        queryKey: queryKeys.recipe(id),
        queryFn: ({ signal }) =>
            withOfflineCopy(
                () => apiRequest<Recipe>(`/api/recipes/${encodeURIComponent(id)}`, { signal }),
                (copy) => recipeFromCopy(copy, id),
            ),
    });
}

/** Whether the server and its database answer (`GET /api/health`). */
export function useHealth() {
    return useQuery({
        queryKey: queryKeys.health,
        queryFn: ({ signal }) => apiRequest<{ status: string }>('/api/health', { signal }),
        // A health check that fails has answered the question; don't keep asking
        retry: false,
    });
}
