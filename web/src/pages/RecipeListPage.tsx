/**
 * @module web/src/pages/RecipeListPage
 * `/`: every recipe, searchable, loading more as you scroll (technical spec §3.4).
 *
 * Rows become tiles on a wider screen. Each row leaves room beside the name
 * for 3b's tag pills, and the tile for its thumbnail.
 *
 * Changes waiting on the device (3c) show at once: new recipes in a "Waiting
 * to upload" list above the rest, searched on the device, and an edited
 * recipe's row with its new name and a tag.
 */

import { useState } from 'react';
import { Link } from 'react-router';
import { useRecipeList } from '../api/queries';
import type { RecipeSummary } from '../api/types';
import { DeleteRecipeDialog } from '../components/DeleteRecipeDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { PlusIcon } from '../components/Icons';
import { LoadMore } from '../components/LoadMore';
import { Menu } from '../components/Menu';
import { recipeMenuItems } from '../components/recipeMenu';
import { SearchBox } from '../components/SearchBox';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useSearchQuery } from '../components/useSearchQuery';
import { WaitingTag } from '../components/Waiting';
import { listMeta } from '../format';
import { matchesSearch } from '../offline/read';
import { recipeFromChange } from '../offline/upload';
import { useWaitingChanges, type WaitingChange } from '../offline/waiting';
import page from '../components/Page.module.css';
import styles from './RecipeListPage.module.css';

function countText(total: number, searching: boolean): string {
    if (searching) return total === 1 ? '1 match' : `${total} matches`;
    return total === 1 ? '1 recipe' : `${total} recipes`;
}

export function RecipeListPage() {
    useDocumentTitle(null);
    const { text, setText, search, clear } = useSearchQuery();
    const list = useRecipeList(search);
    const { items, total, error, isPending, isPlaceholderData, isFetchNextPageError } = list;
    // The recipe whose Delete was chosen, while its confirmation is open
    const [deleting, setDeleting] = useState<RecipeSummary | null>(null);
    // Where a recipe's back link returns to: this list, with this search
    const listUrl = search ? `/?q=${encodeURIComponent(search)}` : '/';

    const { changes } = useWaitingChanges();
    const changeFor = new Map(changes.map((change) => [change.recipeId, change]));
    const listed = new Set(items.map((recipe) => recipe.id));
    const waitingNew = changes.filter(
        (change) =>
            change.kind === 'create' && !listed.has(change.recipeId) && (!search || matchesSearch(change.body.name, search)),
    );

    const row = (recipe: RecipeSummary, change: WaitingChange | undefined) => {
        const shown = change ? recipeFromChange(change, recipe) : recipe;
        return (
            <li key={recipe.id} className={styles.row}>
                <Link to={`/recipes/${recipe.id}`} state={{ from: listUrl }} className={styles.rowLink}>
                    {/* 3b adds the first two tag pills beside the name */}
                    <span className={styles.nameLine}>
                        <span className={styles.name}>{shown.name}</span>
                        {change && <WaitingTag change={change} />}
                    </span>
                    <span className={styles.meta}>{listMeta(shown)}</span>
                </Link>
                <Menu
                    label={`More options for ${shown.name}`}
                    items={recipeMenuItems(recipe.id, () => setDeleting(shown))}
                    buttonClassName={styles.rowMenu}
                />
            </li>
        );
    };

    const newRecipe = (
        <Link to="/recipes/new" className={page.primaryButton}>
            <PlusIcon size={18} />
            New recipe
        </Link>
    );

    return (
        <div className={styles.page}>
            <div className={styles.toolbar}>
                <h1 className={styles.heading}>Recipes</h1>
                <SearchBox label="Search recipes" value={text} onChange={setText} className={styles.search} />
                <div className={styles.newRecipe}>{newRecipe}</div>
            </div>

            {error && (
                <ErrorBanner
                    error={error}
                    onRetry={() => void (isFetchNextPageError ? list.fetchNextPage() : list.refetch())}
                />
            )}

            {isPending && (
                <p role="status" className={page.status}>
                    Loading recipes…
                </p>
            )}

            {waitingNew.length > 0 && (
                <section aria-labelledby="waiting-heading">
                    <h2 id="waiting-heading" className={page.count}>
                        Waiting to upload
                    </h2>
                    <ul aria-labelledby="waiting-heading" className={styles.list}>
                        {waitingNew.map((change) => row(recipeFromChange(change), change))}
                    </ul>
                </section>
            )}

            {!isPending && !error && items.length === 0 && waitingNew.length === 0 && !search && (
                <div className={page.notice}>
                    <p className={page.noticeTitle}>No recipes yet</p>
                    <p className={page.noticeText}>Add your first one and it will show up here.</p>
                    <div className={styles.noticeAction}>{newRecipe}</div>
                </div>
            )}

            {!isPending && !error && items.length === 0 && waitingNew.length === 0 && search && (
                <div className={page.notice}>
                    <p className={page.noticeTitle}>No recipes match “{search}”</p>
                    <button type="button" className={page.textButton} onClick={clear}>
                        Clear search
                    </button>
                </div>
            )}

            {items.length > 0 && (
                <>
                    {total !== null && <p className={page.count}>{countText(total, search !== '')}</p>}
                    <ul aria-label="Recipes" aria-busy={isPlaceholderData} className={styles.list}>
                        {items.map((recipe) => row(recipe, changeFor.get(recipe.id)))}
                    </ul>
                    <LoadMore
                        hasNextPage={list.hasNextPage}
                        isFetchingNextPage={list.isFetchingNextPage}
                        failed={isFetchNextPageError}
                        fetchNextPage={() => void list.fetchNextPage()}
                        pageCount={list.data?.pages.length ?? 0}
                        loadingText="Loading more recipes…"
                    />
                </>
            )}

            {/* From the list there's no ETag to send: the confirmation, by name, is the check */}
            <DeleteRecipeDialog recipe={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
        </div>
    );
}
