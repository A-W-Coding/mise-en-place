/**
 * @module web/src/components/TagPill
 * A tag as a pill (3b): its name with a capital first letter, on the tag's
 * own colour, with dark or light text chosen to read on it
 * (`tags/colour.ts`). The list shows small ones, the recipe page and the
 * editor full-size ones.
 */

import type { ReactNode } from 'react';
import { pillColours, tagLabel } from '../tags/colour';
import styles from './TagPill.module.css';

interface TagPillProps {
    name: string;
    color: string | null;
    size?: 'small' | 'normal';
    /** Something inside the pill after its name, such as the editor's × button. */
    children?: ReactNode;
}

export function TagPill({ name, color, size = 'normal', children }: TagPillProps) {
    return (
        <span className={`${styles.pill} ${size === 'small' ? styles.small : ''} ${children ? styles.withButton : ''}`} style={pillColours(color)}>
            {tagLabel(name)}
            {children}
        </span>
    );
}
