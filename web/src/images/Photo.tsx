/**
 * @module web/src/images/Photo
 * A recipe's photo or thumbnail (3b). If the file can't be had, offline and
 * not cached yet, say, it shows a plain plate rather than a broken image.
 */

import { useState } from 'react';
import { PlateIcon } from '../components/Icons';
import styles from './Photo.module.css';

interface PhotoProps {
    src: string | null;
    /** Empty when the photo only decorates a link that's named already. */
    alt: string;
    className?: string;
    /** The plate's size, when there's no photo. */
    plateSize?: number;
}

export function Photo({ src, alt, className, plateSize = 24 }: PhotoProps) {
    // The address that failed, so a new one gets its own try
    const [failed, setFailed] = useState<string | null>(null);
    if (src === null || failed === src) {
        return (
            <span className={`${styles.plate} ${className ?? ''}`} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
                <PlateIcon size={plateSize} />
            </span>
        );
    }
    return <img src={src} alt={alt} className={`${styles.photo} ${className ?? ''}`} loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}
