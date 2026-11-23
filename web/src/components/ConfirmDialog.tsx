/**
 * @module web/src/components/ConfirmDialog
 * A question that must be answered before carrying on: delete this recipe?
 * leave without saving? reload a recipe changed elsewhere?
 *
 * It's the browser's own <dialog>, opened with showModal(), which keeps focus
 * inside it, shows a backdrop, and closes on Escape (as Cancel). Focus starts
 * on Cancel, the safe answer, and returns to where it was when it closes.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    children: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    /** How the confirm button looks: filled green, filled red, or outlined red. */
    tone?: 'primary' | 'danger' | 'dangerOutline';
    /** While the action runs: the confirm button waits. */
    busy?: boolean;
    /** Why the action failed, shown in the dialog so it can be tried again. */
    error?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    open,
    title,
    children,
    confirmLabel,
    cancelLabel = 'Cancel',
    tone = 'primary',
    busy = false,
    error,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const bodyId = useId();

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) element.showModal();
        if (!open && element.open) element.close();
    }, [open]);

    return (
        <dialog
            ref={dialog}
            role="alertdialog"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className={styles.dialog}
            // Escape: answer Cancel, and let React close it, so open stays the one source of truth
            onCancel={(event) => {
                event.preventDefault();
                onCancel();
            }}
        >
            {/* The content exists only while open, so nothing hidden can be found or focused */}
            {open && (
                <>
                    <h2 id={titleId} className={styles.title}>
                        {title}
                    </h2>
                    <div id={bodyId} className={styles.body}>
                        {children}
                    </div>
                    {error && (
                        <p role="alert" className={styles.error}>
                            {error}
                        </p>
                    )}
                    <div className={styles.actions}>
                        <button type="button" className={styles.cancel} onClick={onCancel}>
                            {cancelLabel}
                        </button>
                        <button type="button" className={styles[tone]} onClick={onConfirm} disabled={busy}>
                            {confirmLabel}
                        </button>
                    </div>
                </>
            )}
        </dialog>
    );
}
