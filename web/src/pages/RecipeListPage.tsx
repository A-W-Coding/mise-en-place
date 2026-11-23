/**
 * @module web/src/pages/RecipeListPage
 * `/`: every recipe, searchable, loading more as you scroll (technical spec §3.4).
 *
 * Rows become tiles on a wider screen. Each row leaves room beside the name
 * for 3b's tag pills, and the tile for its thumbnail.
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
import { listMeta } from '../format';
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

            {!isPending && !error && items.length === 0 && !search && (
                <div className={page.notice}>
                    <p className={page.noticeTitle}>No recipes yet</p>
                    <p className={page.noticeText}>Add your first one and it will show up here.</p>
                    <div className={styles.noticeAction}>{newRecipe}</div>
                </div>
            )}

            {!isPending && !error && items.length === 0 && search && (
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
                        {items.map((recipe) => (
                            <li key={recipe.id} className={styles.row}>
                                <Link to={`/recipes/${recipe.id}`} state={{ from: listUrl }} className={styles.rowLink}>
                                    {/* 3b adds the first two tag pills beside the name */}
                                    <span className={styles.nameLine}>
                                        <span className={styles.name}>{recipe.name}</span>
                                    </span>
                                    <span className={styles.meta}>{listMeta(recipe)}</span>
                                </Link>
                                <Menu
                                    label={`More options for ${recipe.name}`}
                                    items={recipeMenuItems(recipe.id, () => setDeleting(recipe))}
                                    buttonClassName={styles.rowMenu}
                                />
                            </li>
                        ))}
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
