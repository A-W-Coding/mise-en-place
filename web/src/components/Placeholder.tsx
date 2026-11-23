/**
 * @module web/src/components/Placeholder
 * A stand-in page for a screen a later step builds, so the routes work now.
 */

import type { ReactNode } from 'react';
import styles from './Placeholder.module.css';

interface PlaceholderProps {
    title: string;
    /** The Phase 3a step that builds this screen. */
    step: number;
    children?: ReactNode;
}

export function Placeholder({ title, step, children }: PlaceholderProps) {
    return (
        <section className={styles.placeholder}>
            <h1 className={styles.title}>{title}</h1>
            {children}
            <p className={styles.note}>This screen arrives in Step {step}.</p>
        </section>
    );
}
