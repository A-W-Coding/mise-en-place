/**
 * @module web/src/images/PhotoViewer
 * A photo at full size (3b), over the page in a native `<dialog>`: it fits
 * the screen, and Close or Escape returns to where you were, within the app
 * rather than in a new tab.
 */

import { useEffect, useRef } from 'react';
import { CloseIcon } from '../components/Icons';
import { imageUrl } from './media';
import styles from './Photos.module.css';

interface PhotoViewerProps {
    /** The photo to show, or null when closed. */
    imageId: string | null;
    /** Its name for a screen reader: "Photo 2 of Beef Chili". */
    label: string;
    onClose: () => void;
}

export function PhotoViewer({ imageId, label, onClose }: PhotoViewerProps) {
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (imageId && !element.open) element.showModal();
        if (!imageId && element.open) element.close();
    }, [imageId]);

    return (
        <dialog
            ref={dialog}
            aria-label={label}
            className={styles.viewer}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            {imageId && (
                <>
                    <button type="button" className={styles.viewerClose} aria-label="Close" autoFocus onClick={onClose}>
                        <CloseIcon />
                    </button>
                    <img src={imageUrl(imageId)} alt={label} className={styles.viewerImage} />
                </>
            )}
        </dialog>
    );
}
