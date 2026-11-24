/**
 * @module web/src/offline/upload
 * Sending a recipe change to the API, from the editor or from the queue of
 * changes waiting on the device (D15, technical spec §3.4, "Editing
 * offline").
 *
 * - New ingredients go first, each created by name. If one already exists
 *   (409), created elsewhere or by an earlier attempt, it's used.
 * - Then a new recipe is `POST`ed with the id the device gave it, or an edit
 *   is `PATCH`ed with `If-Match`.
 * - **A lost answer.** If an earlier attempt reached the API but its answer
 *   never came back, the retry hears that the recipe already exists (409) or
 *   has changed (412). The recipe is then read back and compared:
 *   - it's this version: it arrived, and counts as uploaded
 *   - it's a version sent earlier from this device: that arrived, and this
 *     newer one is saved over it, with its ETag
 *   - anything else: it changed elsewhere, and this version isn't saved over
 *     it (412)
 *   So a dropped connection never creates a recipe twice, and never saves
 *   over someone else's change.
 *
 * The queue uploads oldest first, at the same moments as the snapshot
 * refresh and before it (`sync.ts`). Each success goes into the offline copy
 * at once. If the Pi can't be reached, the round stops, and the rest wait
 * for the next one.
 */

import type { QueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiResult } from '../api/client';
import { queryKeys } from '../api/queries';
import type { Ingredient, Recipe } from '../api/types';
import { apiBody, type DraftBody, type RecipeBody } from '../editor/draft';
import { putRecipeInCopy } from './copy';
import {
    loadWaitingChanges,
    markProblem,
    noteSent,
    settleUploaded,
    type ChangeProblem,
    type WaitingChange,
} from './waiting';

/** The message for a recipe changed elsewhere, as the API words it. */
export const CHANGED_MESSAGE = 'The recipe has changed since it was loaded.';

/** Create an ingredient by name, or find it if it already exists. */
async function ingredientId(name: string): Promise<string> {
    try {
        return (await apiRequest<Ingredient>('/api/ingredients', { method: 'POST', body: { name } })).data.id;
    } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        const found = await apiRequest<Ingredient[]>(`/api/ingredients?${new URLSearchParams({ search: name, limit: '100' })}`);
        const existing = found.data.find((ingredient) => ingredient.name === name);
        if (!existing) throw error;
        return existing.id;
    }
}

/** The API's body for a change, creating any new ingredients it names. */
async function resolveIngredients(body: DraftBody): Promise<RecipeBody> {
    const ids = new Map<string, string>();
    for (const line of body.ingredients) {
        if (line.ingredientId === null && !ids.has(line.ingredientName)) {
            ids.set(line.ingredientName, await ingredientId(line.ingredientName));
        }
    }
    return apiBody(body, (name) => ids.get(name) ?? '');
}

/**
 * Whether the API's recipe says what this body says: its fields, its
 * method's sections and steps, and its lines with their sections. Lines are
 * compared by ingredient name, which new ingredients have before ids.
 */
export function sameRecipe(recipe: Recipe, body: DraftBody): boolean {
    const fields = (value: Omit<DraftBody, 'ingredients' | 'sections'>) => [
        value.name,
        value.description,
        value.servings,
        value.prepTime,
        value.cookTime,
    ];
    const sections = (value: { name: string; steps: { text: string; timerSeconds: number | null }[] }[]) =>
        value.map((section) => [section.name, section.steps.map((step) => [step.text, step.timerSeconds])]);
    const lines = body.ingredients.map((line) => [
        line.ingredientName,
        line.quantity,
        line.quantityMax,
        line.unit,
        line.note,
        line.sectionIndex,
    ]);
    const sectionIndex = (id: string | null) => {
        const index = recipe.sections.findIndex((section) => section.id === id);
        return index === -1 ? null : index;
    };
    const recipeLines = recipe.recipeIngredients.map((line) => [
        line.ingredient.name,
        line.quantity,
        line.quantityMax,
        line.unit,
        line.note,
        sectionIndex(line.sectionId),
    ]);
    return (
        JSON.stringify([fields(recipe), sections(recipe.sections), recipeLines]) ===
        JSON.stringify([fields(body), sections(body.sections), lines])
    );
}

/** What to send: a recipe's change, with the versions sent before whose answers never came. */
export interface ChangeToSend {
    recipeId: string;
    kind: 'create' | 'edit';
    body: DraftBody;
    etag: string | null;
    sent: DraftBody[];
}

function recipePath(id: string): string {
    return `/api/recipes/${encodeURIComponent(id)}`;
}

/**
 * Send one change: its new ingredients, then the recipe.
 *
 * @returns The API's recipe, with its new ETag.
 * @throws ApiError: a network error when the Pi can't be reached; 412 when
 *         the recipe changed elsewhere; 404 when it was deleted; 400 when
 *         refused.
 */
export async function sendRecipeChange(change: ChangeToSend): Promise<ApiResult<Recipe>> {
    const body = await resolveIngredients(change.body);
    try {
        return change.kind === 'create'
            ? await apiRequest<Recipe>('/api/recipes', { method: 'POST', body: { id: change.recipeId, ...body } })
            : await apiRequest<Recipe>(recipePath(change.recipeId), { method: 'PATCH', body, ifMatch: change.etag });
    } catch (error) {
        // The recipe exists already (a create), or isn't the version this edit started from
        const taken = change.kind === 'create' && error instanceof ApiError && error.status === 409;
        const moved = change.kind === 'edit' && error instanceof ApiError && error.status === 412;
        if (!taken && !moved) throw error;

        const current = await apiRequest<Recipe>(recipePath(change.recipeId));
        if (sameRecipe(current.data, change.body)) return current;
        if (change.sent.some((sent) => sameRecipe(current.data, sent))) {
            return apiRequest<Recipe>(recipePath(change.recipeId), { method: 'PATCH', body, ifMatch: current.etag });
        }
        throw new ApiError(412, CHANGED_MESSAGE);
    }
}

/** After a recipe is saved, by the editor or the queue: the cache and the offline copy get the API's version. */
export async function recordSaved(queryClient: QueryClient, result: ApiResult<Recipe>): Promise<void> {
    queryClient.setQueryData(queryKeys.recipe(result.data.id), result);
    void queryClient.invalidateQueries({ queryKey: ['recipes', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['ingredients'] });
    try {
        await putRecipeInCopy(result.data, result.etag);
    } catch (error) {
        // The next snapshot brings it instead
        console.warn("The saved recipe couldn't be put in the offline copy.", error);
    }
}

function problemFor(error: ApiError): ChangeProblem | null {
    if (error.status === 412) return { kind: 'changed' };
    if (error.status === 404) return { kind: 'deleted' };
    if (error.status === 400) return { kind: 'refused', message: error.message, fields: error.fields };
    return null;
}

/**
 * Upload the waiting changes, oldest first, skipping any that need your
 * attention.
 *
 * @throws ApiError when the Pi can't be reached, or answers with a server
 *         error: the round stops there, and the rest wait for the next.
 */
export async function uploadWaitingChanges(queryClient: QueryClient): Promise<void> {
    const queue = (await loadWaitingChanges())
        .filter((change) => change.problem === null)
        .sort((a, b) => a.createdAt - b.createdAt);

    for (const change of queue) {
        let result: ApiResult<Recipe>;
        try {
            result = await sendRecipeChange(change);
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (error.isNetworkError) {
                await noteSent(change);
                throw error;
            }
            const problem = problemFor(error);
            if (!problem) throw error;
            await markProblem(change, problem);
            continue;
        }
        await settleUploaded(change, result.etag);
        await recordSaved(queryClient, result);
    }
}

/**
 * A waiting change as a whole recipe, for the pages to show. New ingredients
 * get a stand-in id until they're created.
 *
 * @param base - The recipe as it was, for the date it was created.
 */
export function recipeFromChange(change: WaitingChange, base?: { createdAt: string }): Recipe {
    const saved = new Date(change.savedAt).toISOString();
    const { ingredients, sections, ...fields } = change.body;
    const sectionId = (index: number) => `${change.recipeId}:section-${index}`;
    return {
        id: change.recipeId,
        ...fields,
        createdAt: base?.createdAt ?? new Date(change.createdAt).toISOString(),
        updatedAt: saved,
        sections: sections.map((section, index) => ({
            id: sectionId(index),
            recipeId: change.recipeId,
            name: section.name,
            orderIndex: index,
            steps: section.steps.map((step, orderIndex) => ({
                id: `${sectionId(index)}:${orderIndex}`,
                sectionId: sectionId(index),
                orderIndex,
                text: step.text,
                timerSeconds: step.timerSeconds,
            })),
        })),
        recipeIngredients: ingredients.map((line, index) => {
            const id = line.ingredientId ?? `new:${line.ingredientName}`;
            return {
                id: `${change.recipeId}:${index}`,
                recipeId: change.recipeId,
                ingredientId: id,
                orderIndex: index,
                quantity: line.quantity,
                quantityMax: line.quantityMax,
                unit: line.unit,
                note: line.note,
                sectionId: line.sectionIndex === null ? null : sectionId(line.sectionIndex),
                ingredient: { id, name: line.ingredientName, createdAt: saved, updatedAt: saved },
            };
        }),
    };
}
