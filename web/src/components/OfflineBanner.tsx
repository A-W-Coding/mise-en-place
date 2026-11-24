/**
 * @module web/src/components/OfflineBanner
 * Shown at the top of a page that's reading the offline copy because the API
 * can't be reached, with how old the copy is (technical spec §3.4,
 * "Refreshing"). It goes once the API answers again and the page has fetched
 * from it.
 */

import { formatAge } from '../format';
import { useOfflineCopy } from '../offline/copy';
import { useServedFromCopy } from '../offline/useServedFromCopy';
import { useNow } from './useNow';
import styles from './OfflineBanner.module.css';

export function OfflineBanner({ onRetry }: { onRetry: () => void }) {
    const fromCopy = useServedFromCopy();
    const { copy } = useOfflineCopy();
    const now = useNow();
    if (!fromCopy || !copy) return null;

    return (
        <div role="status" className={styles.banner}>
            <p className={styles.message}>
                <strong>Can't reach the server.</strong> Showing the copy saved on this device, refreshed{' '}
                {formatAge(copy.checkedAt, now)}.
            </p>
            <button type="button" className={styles.retry} onClick={onRetry}>
                Retry
            </button>
        </div>
    );
}
