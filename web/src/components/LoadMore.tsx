/**
 * @module web/src/components/LoadMore
 * The end of an infinite list: the invisible marker that loads the next page
 * as it comes near, and a note while that page loads.
 */

import { useLoadMore } from './useLoadMore';
import styles from './Page.module.css';

interface LoadMoreProps {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    /** A failed page waits for Retry rather than trying again on every scroll. */
    failed: boolean;
    fetchNextPage: () => void;
    pageCount: number;
    /** "Loading more recipes…" */
    loadingText: string;
}

export function LoadMore({ hasNextPage, isFetchingNextPage, failed, fetchNextPage, pageCount, loadingText }: LoadMoreProps) {
    const sentinel = useLoadMore(hasNextPage && !isFetchingNextPage && !failed, fetchNextPage, pageCount);

    return (
        <>
            {hasNextPage && <div ref={sentinel} data-testid="load-more" />}
            {isFetchingNextPage && (
                <p role="status" className={styles.status}>
                    {loadingText}
                </p>
            )}
        </>
    );
}
