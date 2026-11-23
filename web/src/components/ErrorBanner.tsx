/**
 * @module web/src/components/ErrorBanner
 * A failed request, shown at the top of the page with a way to try again.
 * When the page already has data, the data stays below it.
 */

import type { ApiError } from '../api/client';
import { errorMessage } from '../api/errorMessage';
import styles from './ErrorBanner.module.css';

interface ErrorBannerProps {
    error: ApiError;
    onRetry: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
    return (
        <div role="alert" className={styles.banner}>
            <span className={styles.message}>{errorMessage(error)}</span>
            <button type="button" className={styles.retry} onClick={onRetry}>
                Retry
            </button>
        </div>
    );
}
