/**
 * @module web/src/pages/IngredientsPage
 * `/options/ingredients`: the shared ingredient list, searchable, loading more
 * as you scroll. Renaming and deleting come in Step 12.
 */

import { useIngredientList } from '../api/queries';
import { BackLink } from '../components/BackLink';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadMore } from '../components/LoadMore';
import { SearchBox } from '../components/SearchBox';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useSearchQuery } from '../components/useSearchQuery';
import page from '../components/Page.module.css';
import styles from './IngredientsPage.module.css';

function countText(total: number, searching: boolean): string {
    if (searching) return total === 1 ? '1 match' : `${total} matches`;
    return total === 1 ? '1 ingredient' : `${total} ingredients`;
}

export function IngredientsPage() {
    useDocumentTitle('Ingredients');
    const { text, setText, search, clear } = useSearchQuery();
    const list = useIngredientList(search);
    const { items, total, error, isPending, isPlaceholderData, isFetchNextPageError } = list;

    return (
        <div className={styles.page}>
            <BackLink to="/options">Options</BackLink>
            <h1 className={styles.heading}>Ingredients</h1>
            <SearchBox label="Search ingredients" value={text} onChange={setText} />

            {error && (
                <ErrorBanner
                    error={error}
                    onRetry={() => void (isFetchNextPageError ? list.fetchNextPage() : list.refetch())}
                />
            )}

            {isPending && (
                <p role="status" className={page.status}>
                    Loading ingredients…
                </p>
            )}

            {!isPending && !error && items.length === 0 && (
                <div className={page.notice}>
                    {search ? (
                        <>
                            <p className={page.noticeTitle}>No ingredients match “{search}”</p>
                            <button type="button" className={page.textButton} onClick={clear}>
                                Clear search
                            </button>
                        </>
                    ) : (
                        <>
                            <p className={page.noticeTitle}>No ingredients yet</p>
                            <p className={page.noticeText}>They're added as you write recipes.</p>
                        </>
                    )}
                </div>
            )}

            {items.length > 0 && (
                <>
                    {total !== null && <p className={page.count}>{countText(total, search !== '')}</p>}
                    <ul aria-label="Ingredients" aria-busy={isPlaceholderData} className={styles.list}>
                        {items.map((ingredient) => (
                            <li key={ingredient.id} className={styles.row}>
                                {ingredient.name}
                            </li>
                        ))}
                    </ul>
                    <LoadMore
                        hasNextPage={list.hasNextPage}
                        isFetchingNextPage={list.isFetchingNextPage}
                        failed={isFetchNextPageError}
                        fetchNextPage={() => void list.fetchNextPage()}
                        pageCount={list.data?.pages.length ?? 0}
                        loadingText="Loading more ingredients…"
                    />
                </>
            )}
        </div>
    );
}
